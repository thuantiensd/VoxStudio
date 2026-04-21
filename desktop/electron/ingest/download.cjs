/**
 * Download ingested media URL → file local → POST lên backend /dubbing/projects
 * để tạo dubbing project. Trả project_id.
 */
const { net } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

async function downloadToFile(mediaUrl, headers, destPath, onProgress) {
  const req = net.request({
    method: "GET",
    url: mediaUrl,
    useSessionCookies: false,
  });
  for (const [k, v] of Object.entries(headers || {})) {
    if (v) req.setHeader(k, v);
  }

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    let downloaded = 0;
    let total = 0;
    let lastEmit = 0;

    req.on("response", (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        writer.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`HTTP ${res.statusCode} khi tải media URL.`));
        return;
      }
      total = parseInt(res.headers["content-length"]?.[0] || 0, 10) || 0;

      res.on("data", (chunk) => {
        writer.write(chunk);
        downloaded += chunk.length;
        const now = Date.now();
        if (now - lastEmit > 250 && total) {
          const pct = (downloaded / total) * 100;
          onProgress && onProgress({
            progress: Math.min(92, 50 + pct * 0.42),
            downloaded, total,
          });
          lastEmit = now;
        }
      });
      res.on("end", () => {
        writer.end(() => resolve({ downloaded, total }));
      });
      res.on("error", (e) => {
        writer.close();
        fs.unlink(destPath, () => {});
        reject(e);
      });
    });
    req.on("error", (e) => {
      writer.close();
      fs.unlink(destPath, () => {});
      reject(e);
    });
    req.end();
  });
}

/**
 * uploadToBackend — POST multipart /dubbing/projects với file tạm.
 * VITE_API_URL lấy từ env (hoặc localhost:8000 default).
 */
async function uploadToBackend(apiBase, filePath, filename, opts = {}) {
  // Node 22+ native FormData + Blob — đã có trong Electron 41
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf], { type: "video/mp4" });

  const form = new FormData();
  form.append("video", blob, filename);
  form.append("target_language", opts.targetLanguage || "vietnamese");
  form.append("source_language", opts.sourceLanguage || "auto");
  form.append("enable_dubbing", String(opts.enableDubbing ?? true));
  form.append("enable_subtitle", String(opts.enableSubtitle ?? false));
  if (opts.voiceId) form.append("voice_id", opts.voiceId);

  const res = await fetch(`${apiBase}/api/v1/dubbing/projects`, {
    method: "POST",
    body: form,
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend upload lỗi ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

function tempPath(filename) {
  const dir = path.join(os.tmpdir(), "voxstudio-ingest");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${filename}`);
}

function safeName(name) {
  return (name || "video").replace(/[^\w \-.]/g, "_").slice(0, 80) || "video";
}

module.exports = { downloadToFile, uploadToBackend, tempPath, safeName };
