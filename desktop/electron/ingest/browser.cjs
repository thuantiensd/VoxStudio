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
  // Collect candidate media URLs + their response headers
  const candidates = new Map(); // url → { contentType, contentLength }
  const collectedHeaders = {};  // cookies / referer cho URL chiến thắng

  const webRequest = ingestSession.webRequest;

  const onCompleted = (details) => {
    try {
      const ct = details.responseHeaders?.["content-type"]?.[0]
              || details.responseHeaders?.["Content-Type"]?.[0]
              || null;
      const url = details.url;
      if (!url || !url.startsWith("http")) return;
      if (!adapter.isMediaURL(url, ct)) return;
      const len = parseInt(
        details.responseHeaders?.["content-length"]?.[0]
        || details.responseHeaders?.["Content-Length"]?.[0]
        || "0",
        10,
      ) || 0;
      // Keep only biggest known (skip thumbnail .mp4 tiny assets)
      if (len > 0 && len < 32 * 1024) return;
      candidates.set(url, { contentType: ct, contentLength: len });
      onProgress("detecting", 40, `Thấy media stream (${candidates.size})`);
    } catch {}
  };
  webRequest.onCompleted({ urls: ["http://*/*", "https://*/*"] }, onCompleted);

  const win = new BrowserWindow({
    show: false,
    width: 1280, height: 720,
    webPreferences: {
      session: ingestSession,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,       // not offscreen — need real rendering cho player play
      webSecurity: true,
      javascript: true,
      sandbox: false,
    },
  });
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
    // Electron API: onCompleted(null) để unregister global handler — nhưng
    // listener này gắn vào session cụ thể, session sẽ GC cùng BrowserWindow.
    try { if (!win.isDestroyed()) win.destroy(); } catch {}
  };

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
      throw new Error(
        "Không thấy media URL nào (video có thể bị DRM, không có stream mp4 trực "
        + "tiếp, hoặc cần login). Thử chế độ Toàn năng."
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
