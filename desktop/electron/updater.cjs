/**
 * electron-updater wrapper.
 *
 * Check update lúc app ready + mỗi 4h. Khi có bản mới:
 *   1. Tự động download background.
 *   2. Khi download xong, emit event → renderer hiện banner "Bản mới sẵn sàng".
 *   3. User click → app.quit + install update.
 *
 * Production chỉ hoạt động khi:
 *   - App đã signed (mac) hoặc có file .yml trên Release (win/linux).
 *   - package.json.build.publish trỏ đúng GitHub repo.
 *
 * Dev mode: autoUpdater không bao giờ tìm ra update (không có release
 * để so sánh) → noop.
 */
const { app } = require("electron");

function initUpdater(mainWindow) {
  if (!app.isPackaged) {
    console.log("[updater] dev mode — skip");
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    console.warn("[updater] electron-updater not available:", e.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  // Logging
  autoUpdater.logger = console;

  // Forward events to renderer qua webContents.send
  const send = (channel, ...args) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
      }
    } catch {}
  };

  autoUpdater.on("checking-for-update", () => {
    send("update:checking");
  });
  autoUpdater.on("update-available", (info) => {
    send("update:available", {
      version: info.version,
      releaseDate: info.releaseDate,
      notes: info.releaseNotes,
    });
  });
  autoUpdater.on("update-not-available", () => {
    send("update:not-available");
  });
  autoUpdater.on("download-progress", (p) => {
    send("update:progress", {
      percent: Math.round(p.percent),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    send("update:downloaded", {
      version: info.version,
      notes: info.releaseNotes,
    });
  });
  autoUpdater.on("error", (err) => {
    console.warn("[updater] error:", err?.message || err);
    send("update:error", { message: err?.message || String(err) });
  });

  // Kick first check sau 8s (đủ thời gian app warm up)
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  // Mỗi 4h check 1 lần
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}),
              4 * 60 * 60 * 1000);

  return autoUpdater;
}

module.exports = { initUpdater };
