/**
 * Browser ingest — mở BrowserWindow ẨN, load URL, intercept network request để
 * lấy media URL trực tiếp (mp4/m3u8). Chạy đúng Chromium context của user nên
 * TikTok/FB/IG anti-bot vượt qua được.
 */
const { BrowserWindow, session, net } = require("electron");
const { pickAdapter } = require("./adapters.cjs");

// Persistent session — giữ cookie (user login FB 1 lần, lần sau tự có)
const SESSION_NAME = "persist:vox-ingest";

function buildMediaURL(url) {
  try { return new URL(url); } catch { return null; }
}

/**
 * captureMediaURL(url, opts) — trả về { mediaUrl, meta, cookies, adapter, errors }
 * opts: { onProgress(label,pct) }
 */
async function captureMediaURL(inputURL, opts = {}) {
  const { onProgress = () => {} } = opts;
  const adapter = pickAdapter(inputURL);
  onProgress("opening", 5, `Đang mở trình duyệt ẩn (${adapter.platform})…`);

  const ingestSession = session.fromPartition(SESSION_NAME);
  const candidates = new Map(); // url → { contentType, contentLength }
  // Debug: tất cả URL trông-có-video — in console để debug khi không match.
  const seenMediaish = [];

  const webRequest = ingestSession.webRequest;

  const onCompleted = (details) => {
    try {
      const ct = details.responseHeaders?.["content-type"]?.[0]
              || details.responseHeaders?.["Content-Type"]?.[0]
              || null;
      const url = details.url;
      if (!url || !url.startsWith("http")) return;
      const looksVideo = ct && (
        ct.startsWith("video/") || ct.includes("mpegurl") || ct.includes("dash+xml")
      );
      const urlHint = /\.(mp4|m3u8|m4s|webm|mov|ts)(\?|$)/i.test(url);
      if (looksVideo || urlHint) {
        seenMediaish.push({ url: url.slice(0, 180), ct });
      }
      if (!adapter.isMediaURL(url, ct)) return;
      const len = parseInt(
        details.responseHeaders?.["content-length"]?.[0]
        || details.responseHeaders?.["Content-Length"]?.[0]
        || "0",
        10,
      ) || 0;
      if (len > 0 && len < 32 * 1024) return;
      candidates.set(url, { contentType: ct, contentLength: len });
      onProgress("detecting", 40, `Thấy media stream (${candidates.size})`);
    } catch {}
  };
  webRequest.onCompleted({ urls: ["http://*/*", "https://*/*"] }, onCompleted);

  const win = new BrowserWindow({
    show: false,
    width: 1280, height: 720,
    // Tuyệt đối không cho phép window hiện ra / phát tiếng
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      session: ingestSession,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,       // not offscreen — need real rendering cho player play
      webSecurity: true,
      javascript: true,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  // Tắt audio ngay lập tức — ngăn rò rỉ tiếng từ video player.
  win.webContents.setAudioMuted(true);
  // Chặn mọi pop-up / new window từ trang TikTok
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Chặn detection qua navigator.webdriver
  win.webContents.session.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  let pageMeta = null;
  let aborted = false;
  let timer = null;

  const cleanup = () => {
    clearTimeout(timer);
    try { win.webContents.setAudioMuted(true); } catch {}
    try { win.webContents.stop(); } catch {}
    try { if (!win.isDestroyed()) win.destroy(); } catch {}
  };

  // Hard timeout — force-kill sau 30s tuyệt đối, bất kể state
  const HARD_TIMEOUT_MS = 30000;
  timer = setTimeout(() => {
    aborted = true;
    cleanup();
  }, HARD_TIMEOUT_MS);

  try {
    await win.loadURL(inputURL, { userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    });
    onProgress("loading", 15, "Đã load trang, chờ media…");

    // Wait for DOM ready then fire trigger scripts
    await new Promise((r) => setTimeout(r, 800));
    for (const js of adapter.pageScripts || []) {
      try { await win.webContents.executeJavaScript(js, true); } catch {}
    }

    // Extract meta
    try {
      pageMeta = await win.webContents.executeJavaScript(adapter.getMeta, true);
    } catch (e) {
      pageMeta = { title: "", author: null, thumbnail: null, duration: null };
    }
    onProgress("meta", 25, pageMeta?.title || "Đang phân tích…");

    // Wait for at least 1 candidate media URL + some settle time
    const deadline = Date.now() + (adapter.waitMs || 15000);
    while (Date.now() < deadline) {
      if (candidates.size > 0) {
        // Extra 1.2s settle — allow HD variant to arrive
        const waitMore = Math.min(1200, deadline - Date.now());
        if (waitMore > 0) await new Promise((r) => setTimeout(r, waitMore));
        break;
      }
      if (aborted) throw new Error("canceled");
      await new Promise((r) => setTimeout(r, 250));
    }

    if (candidates.size === 0) {
      // In danh sách URL video-ish thấy được → giúp debug
      if (seenMediaish.length > 0) {
        console.warn("[ingest] Detected video-like URLs but none matched filter:");
        seenMediaish.slice(0, 8).forEach((s) => console.warn("  ·", s.ct || "(no ct)", s.url));
      } else {
        console.warn("[ingest] No video-like network requests detected at all");
      }
      throw new Error(
        "Không thấy media URL nào. Video có thể bị DRM, bị ẩn qua JS encryption, "
        + "hoặc cần login. Thử chế độ Toàn năng hoặc tải bằng tool khác rồi kéo vào Studio."
      );
    }

    // Pick best URL
    const urls = [...candidates.keys()];
    const chosen = adapter.pickBest(urls) || urls[urls.length - 1];
    const meta = candidates.get(chosen) || {};

    // Get cookies for the chosen URL's domain
    const u = buildMediaURL(chosen);
    const cookies = u ? await ingestSession.cookies.get({ url: u.origin }) : [];
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    onProgress("captured", 50, "Đã lấy link stream");

    return {
      mediaUrl: chosen,
      adapter,
      platform: adapter.platform,
      contentType: meta.contentType || "video/mp4",
      contentLength: meta.contentLength || 0,
      meta: pageMeta || {},
      headers: {
        Referer: inputURL,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
          + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Cookie: cookieHeader,
      },
    };
  } finally {
    cleanup();
  }
}

module.exports = { captureMediaURL };
