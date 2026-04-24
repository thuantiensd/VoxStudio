/**
 * Local yt-dlp downloader — chạy yt-dlp trên máy user (Electron main).
 *
 * Lợi: 0 bandwidth server + 0 IP ban risk + unlimited download free.
 *
 * Tìm binary theo thứ tự:
 *   1. Bundled binary trong process.resourcesPath/bin/ (production build)
 *   2. Dev: ../bin/yt-dlp_macos (win: yt-dlp.exe)
 *   3. System PATH: `yt-dlp`
 *   4. Python module: `python3 -m yt_dlp` (nếu user đã pip install)
 *
 * Progress parsing: yt-dlp --progress-template gửi JSON mỗi line → parse,
 * forward qua webContents.send("download:progress", {...}).
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

/** Resolve đường dẫn yt-dlp khả dụng. */
function resolveYtDlp() {
  const plat = process.platform;
  const name = plat === "win32" ? "yt-dlp.exe" : "yt-dlp_macos";
  // Candidate paths (thử theo thứ tự)
  const candidates = [
    // 1. Bundled trong app (production: electron-builder extraResources)
    process.resourcesPath
      ? path.join(process.resourcesPath, "bin", name)
      : null,
    // 2. Dev workspace: desktop/bin/
    path.join(__dirname, "..", "bin", name),
    path.join(__dirname, "..", "bin", "yt-dlp"),
    // 3. Common user install locations
    "/usr/local/bin/yt-dlp",
    "/opt/homebrew/bin/yt-dlp",
    path.join(os.homedir(), "yes", "bin", "yt-dlp"),   // conda default
    path.join(os.homedir(), "miniconda3", "bin", "yt-dlp"),
    path.join(os.homedir(), "anaconda3", "bin", "yt-dlp"),
    path.join(os.homedir(), ".local", "bin", "yt-dlp"),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return { cmd: p, args: [] };
    } catch {}
  }
  // Fallback: dựa vào PATH (spawn sẽ resolve)
  return { cmd: plat === "win32" ? "yt-dlp.exe" : "yt-dlp", args: [] };
}

/**
 * Resolve ffmpeg binary path — cần cho yt-dlp merge video+audio.
 * Nếu không tìm thấy → yt-dlp sẽ không merge được, để lại 2 file rời.
 * Trả null nếu không có.
 */
function resolveFfmpeg() {
  const plat = process.platform;
  const name = plat === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    // Bundled
    process.resourcesPath
      ? path.join(process.resourcesPath, "bin", name)
      : null,
    path.join(__dirname, "..", "bin", name),
    // System
    "/opt/homebrew/bin/ffmpeg",     // Apple Silicon Homebrew
    "/usr/local/bin/ffmpeg",         // Intel Homebrew
    "/usr/bin/ffmpeg",               // system
    path.join(os.homedir(), "yes", "bin", "ffmpeg"),
    path.join(os.homedir(), "miniconda3", "bin", "ffmpeg"),
    path.join(os.homedir(), "anaconda3", "bin", "ffmpeg"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

/**
 * _uniqueSyncPath — tìm tên file chưa tồn tại trong folder.
 * Nếu "name.mp4" đã có → thử "name (1).mp4" → "name (2).mp4" ...
 */
function _uniqueSyncPath(folder, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(folder, filename);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${base} (${i})${ext}`);
    i += 1;
    if (i > 999) break;  // safety
  }
  return candidate;
}

/** yt-dlp format selector — ưu tiên H.264 tối đa để QuickTime mở được. */
function buildFormatSelector(maxHeight = 1080, prefer264 = true) {
  const h = Math.max(240, Math.min(2160, parseInt(maxHeight) || 1080));
  if (prefer264) {
    // Thử lần lượt từ ngon → tệ:
    //   1. H.264 + AAC (QuickTime native)
    //   2. H.264 + bất cứ audio nào
    //   3. Progressive MP4 single file (thường FB/YT có bản H.264 720p)
    //   4. HEVC/H.265 (QuickTime từ macOS 10.13 hỗ trợ)
    //   5. Bất cứ MP4 container
    //   6. Whatever is best (VP9/AV1 — last resort, QuickTime may fail)
    return (
      `bestvideo[vcodec^=avc1][height<=${h}]+bestaudio[acodec^=mp4a]` +
      `/bestvideo[vcodec^=avc1][height<=${h}]+bestaudio` +
      `/best[vcodec^=avc1][height<=${h}][ext=mp4]` +
      `/bestvideo[vcodec^=hvc1][height<=${h}]+bestaudio` +
      `/bestvideo[vcodec^=h265][height<=${h}]+bestaudio` +
      `/bestvideo[ext=mp4][height<=${h}]+bestaudio[ext=m4a]` +
      `/best[ext=mp4][height<=${h}]` +
      `/bestvideo[height<=${h}]+bestaudio` +
      `/best[height<=${h}]`
    );
  }
  return `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`;
}

/**
 * Download video về folder user chọn.
 *
 * @param {object}  opts
 * @param {string}  opts.url
 * @param {string}  opts.folder       folder đích (absolute)
 * @param {number}  opts.maxHeight    1080 | 720 | 480 | 2160
 * @param {boolean} opts.prefer264    true = ưu tiên H.264 sẵn (mặc định)
 * @param {boolean} opts.transcode    ép transcode sang H.264 sau download (heavy)
 * @param {(p:object)=>void} opts.onProgress
 * @returns {{ promise: Promise, cancel: () => void }}
 */
function download(opts) {
  const {
    url, folder, filename, maxHeight = 1080, prefer264 = true,
    transcode = false,
    onProgress = () => {},
  } = opts;

  if (!url || !folder) {
    return {
      promise: Promise.reject(new Error("Thiếu URL hoặc thư mục lưu")),
      cancel: () => {},
    };
  }

  const { cmd, args: preArgs } = resolveYtDlp();
  const fmt = buildFormatSelector(maxHeight, prefer264);

  // Progress template: JSON mỗi line để parse dễ
  const progressTemplate =
    '{"type":"progress","percent":"%(progress._percent_str)s",'
    + '"speed":"%(progress._speed_str)s","eta":"%(progress._eta_str)s",'
    + '"downloaded":"%(progress._downloaded_bytes_str)s",'
    + '"total":"%(progress._total_bytes_str)s"}';

  // Resolve output filename. Nếu user cho custom filename → unique sync ngay.
  // Nếu không → dùng template có %(id)s để yt-dlp tự tránh collision same video.
  let outTemplate;
  if (filename && typeof filename === "string") {
    const clean = filename.replace(/\.[a-z0-9]{1,5}$/i, "");
    // Tìm tên unique: "name.mp4" → "name (1).mp4" → ...
    const target = _uniqueSyncPath(folder, `${clean}.mp4`);
    const base = path.basename(target, ".mp4");
    outTemplate = path.join(folder, `${base}.%(ext)s`);
  } else {
    // Include short video ID nếu không có custom name — đảm bảo different
    // videos cùng title không đè nhau, same video re-download → replace OK.
    outTemplate = path.join(folder, "%(title).150s [%(id).11s].%(ext)s");
  }

  // ffmpeg cần thiết để yt-dlp merge video+audio thành 1 file
  const ffmpegPath = resolveFfmpeg();

  const args = [
    ...preArgs,
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--restrict-filenames",   // dấu tiếng Việt OK, nhưng bỏ ký tự đặc biệt
    "--format", fmt,
    // Sort format: ưu tiên codec H.264 trên mọi thứ khác — yt-dlp sẽ
    // pick H.264 ở res thấp hơn thay vì VP9/AV1 ở res cao, vì mục tiêu
    // là file chạy được trên QuickTime/mọi player.
    "--format-sort", "vcodec:h264,vcodec:h265,ext:mp4,res,br,acodec:m4a",
    "--merge-output-format", "mp4",
    "--progress-template", progressTemplate,
    "-o", outTemplate,
    "--concurrent-fragments", "8",
    "--retries", "3",
  ];

  // Pass ffmpeg path explicit (app bundle PATH cleanroom không có ffmpeg)
  if (ffmpegPath) {
    args.push("--ffmpeg-location", ffmpegPath);
  }

  // KHÔNG dùng yt-dlp --recode-video vì nó chỉ check ext (mp4) không check
  // codec bên trong (VP9 trong .mp4 vẫn bị skip). Thay bằng transcode
  // manual sau khi yt-dlp xong (xem block post-download bên dưới).

  args.push(url);

  const child = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let finalPath = null;
  let lastStep = "starting";
  const emit = (evt) => { try { onProgress(evt); } catch {} };

  if (!ffmpegPath) {
    return {
      promise: Promise.reject(new Error(
        "Máy bạn chưa cài ffmpeg — cần để ghép video + audio. " +
        "Mở Terminal và chạy: brew install ffmpeg"
      )),
      cancel: () => {},
    };
  }

  emit({ step: "starting", label: "Khởi động…", progress: 0 });

  // Stdout: progress JSON + "[download] Destination:" + "[Merger] Merging"
  child.stdout.on("data", (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const ln of lines) {
      if (!ln.trim()) continue;
      // JSON progress line?
      if (ln.startsWith('{"type":"progress"')) {
        try {
          const p = JSON.parse(ln);
          const pct = parseFloat((p.percent || "0%").replace("%", "").trim()) || 0;
          emit({
            step: "downloading",
            label: "Đang tải…",
            progress: pct,
            speed: p.speed,
            eta: p.eta,
          });
          lastStep = "downloading";
        } catch {}
        continue;
      }
      if (ln.includes("[download] Destination:")) {
        finalPath = ln.split("Destination:")[1].trim();
      } else if (/\[Merger\]/.test(ln)) {
        emit({ step: "merging", label: "Ghép video + audio…", progress: 95 });
        lastStep = "merging";
      } else if (/\[VideoConvertor\]/.test(ln) || /\[ffmpeg\]/i.test(ln)) {
        emit({ step: "transcoding", label: "Chuyển mã H.264…", progress: 97 });
        lastStep = "transcoding";
      } else if (/Merging formats into/.test(ln)) {
        const m = ln.match(/"([^"]+)"/);
        if (m) finalPath = m[1];
      }
    }
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
  });

  const promise = new Promise((resolve, reject) => {
    child.on("error", (e) => {
      reject(new Error(`Không chạy được yt-dlp: ${e.message}. Cài đặt qua: brew install yt-dlp hoặc pip install yt-dlp`));
    });
    child.on("close", async (code) => {
      if (code !== 0) {
        const userMsg = extractUserError(stderrBuf) || `Lỗi tải (code ${code})`;
        reject(new Error(userMsg));
        return;
      }
      // Download xong — nếu transcode=true thì check codec thực và
      // re-encode sang H.264 + AAC cho QuickTime compat.
      if (transcode && finalPath && ffmpegPath) {
        try {
          const needsTranscode = await _probeNeedsTranscode(ffmpegPath, finalPath);
          if (needsTranscode) {
            emit({ step: "transcoding",
                    label: "Chuyển mã H.264 cho QuickTime…",
                    progress: 96 });
            await _transcodeToH264(ffmpegPath, finalPath, emit);
          }
        } catch (e) {
          // Transcode fail không fatal — user vẫn có file VP9, chỉ warn
          console.warn("[downloader] transcode skipped:", e?.message);
        }
      }
      emit({ step: "done", label: "Hoàn tất", progress: 100, path: finalPath });
      resolve({ path: finalPath });
    });
  });

  return {
    promise,
    cancel: () => {
      try { child.kill("SIGTERM"); } catch {}
    },
  };
}


/**
 * Probe codec bằng ffmpeg -i (stderr) — return true nếu cần transcode.
 * Cần transcode nếu vcodec không phải h264/hevc HOẶC acodec không phải aac.
 */
async function _probeNeedsTranscode(ffmpegPath, filePath) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-i", filePath],
                     { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (c) => { stderr += c.toString(); });
    p.on("close", () => {
      // Parse stderr cho "Stream #...: Video: <codec>"
      const videoMatch = stderr.match(/Stream .*: Video: (\w+)/);
      const audioMatch = stderr.match(/Stream .*: Audio: (\w+)/);
      const vcodec = (videoMatch?.[1] || "").toLowerCase();
      const acodec = (audioMatch?.[1] || "").toLowerCase();
      // h264 / hevc OK cho QuickTime. aac OK cho audio.
      const videoOK = ["h264", "hevc", "h265"].includes(vcodec);
      const audioOK = ["aac", "mp3"].includes(acodec);
      resolve(!videoOK || !audioOK);
    });
    p.on("error", () => resolve(false));
  });
}


/** Chạy ffmpeg transcode → h264+aac, ghi đè file gốc. */
async function _transcodeToH264(ffmpegPath, filePath, emit) {
  const tmpPath = filePath.replace(/\.[^.]+$/, "") + ".transcode.mp4";
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner", "-loglevel", "error", "-stats",
      "-y",
      "-i", filePath,
      "-c:v", "libx264", "-preset", "fast", "-crf", "22",
      "-pix_fmt", "yuv420p",        // bắt buộc cho QuickTime
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",    // streamable
      tmpPath,
    ];
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    // Parse progress từ ffmpeg stats (time=HH:MM:SS.xx)
    let stderr = "";
    p.stderr.on("data", (c) => {
      const s = c.toString();
      stderr += s;
      const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m) {
        // Lần đầu chưa biết tổng duration → hiện progress dạng "Đã xử lý Xs"
        const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        emit({ step: "transcoding",
                label: `Chuyển mã H.264… (đã xử lý ${Math.round(secs)}s)`,
                progress: 97 });
      }
    });
    p.on("error", (e) => reject(e));
    p.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg transcode failed (${code}): ${stderr.slice(-300)}`));
        return;
      }
      // Replace original file
      try {
        await fsPromises.unlink(filePath);
        await fsPromises.rename(tmpPath, filePath);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** Extract user-friendly error từ yt-dlp stderr. */
function extractUserError(stderr) {
  if (!stderr) return null;
  const lines = stderr.split("\n").filter(Boolean);
  // Common patterns
  if (/HTTP Error 404/i.test(stderr)) return "Video không tồn tại hoặc đã bị xoá.";
  if (/Private video/i.test(stderr)) return "Video ở chế độ riêng tư, không tải được.";
  if (/Sign in to confirm/i.test(stderr) || /login required/i.test(stderr))
    return "Video yêu cầu đăng nhập. Mở trong Chrome và đăng nhập rồi thử lại.";
  if (/Unsupported URL/i.test(stderr)) return "Nền tảng này chưa được hỗ trợ.";
  if (/No such file or directory/i.test(stderr))
    return "Không tìm thấy yt-dlp. Cài qua: brew install yt-dlp";
  if (/Requested format is not available/i.test(stderr))
    return "Video không có định dạng phù hợp. Thử đổi độ phân giải khác.";
  // Last resort: last ERROR line
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^ERROR:/i.test(lines[i])) {
      return lines[i].replace(/^ERROR:\s*/i, "").slice(0, 200);
    }
  }
  return null;
}

/**
 * Fetch metadata only (không download) — cho preview.
 */
function fetchInfo(url) {
  return new Promise((resolve, reject) => {
    const { cmd, args: preArgs } = resolveYtDlp();
    const proc = spawn(cmd, [
      ...preArgs,
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      url,
    ], { stdio: ["ignore", "pipe", "pipe"], shell: false });

    let out = "", err = "";
    proc.stdout.on("data", (c) => { out += c.toString(); });
    proc.stderr.on("data", (c) => { err += c.toString(); });
    proc.on("error", (e) => reject(new Error(`yt-dlp: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(extractUserError(err) || `Fetch info failed (${code})`));
        return;
      }
      try {
        const info = JSON.parse(out);
        resolve({
          title: info.title,
          author: info.uploader || info.channel,
          thumbnail: info.thumbnail,
          duration: info.duration,
          platform: info.extractor_key,
          formats: (info.formats || []).length,
          webpage_url: info.webpage_url || url,
        });
      } catch (e) {
        reject(new Error("Không đọc được metadata"));
      }
    });
  });
}

module.exports = { download, fetchInfo, resolveYtDlp, resolveFfmpeg };
