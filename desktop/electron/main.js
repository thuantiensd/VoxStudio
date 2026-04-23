import { app, BrowserWindow, Menu, shell, ipcMain, dialog, Notification, safeStorage } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fsSync from "node:fs";
import { createRequire } from "node:module";
import windowStateKeeper from "electron-window-state";

// Sentry + updater init — require CJS modules
const require_ = createRequire(import.meta.url);
try {
  const { initSentry } = require_("./sentry-init.cjs");
  initSentry();
} catch (e) {
  console.warn("[sentry] skipped:", e.message);
}
let _updaterApi = null;
function _loadUpdater(mainWindow) {
  try {
    const { initUpdater } = require_("./updater.cjs");
    _updaterApi = initUpdater(mainWindow);
  } catch (e) {
    console.warn("[updater] skipped:", e.message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
const VITE_DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5174";

let mainWindow = null;

function createWindow() {
  // Persist size + position qua các lần mở app.
  const winState = windowStateKeeper({
    defaultWidth: 1440,
    defaultHeight: 900,
  });

  const isMac = process.platform === "darwin";

  // Icon file phù hợp theo OS (chỉ cần cho Win/Linux — Mac dùng .icns
  // thông qua electron-builder lúc build, dock icon set riêng bên dưới).
  const iconFile = process.platform === "win32" ? "icon.ico"
                  : process.platform === "linux" ? "icon.png"
                  : "icon.png";  // mac dev: PNG là OK cho dock
  const iconPath = path.join(__dirname, "..", "build", "icons", iconFile);

  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 1024,
    minHeight: 640,
    title: "VoxStudio",
    icon: iconPath,
    backgroundColor: "#0a0a0a",
    // Mac: traffic lights native chừa sẵn; Win/Linux: tắt chrome, custom React titlebar.
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    trafficLightPosition: isMac ? { x: 16, y: 12 } : undefined,
    titleBarOverlay: !isMac ? {
      color: "#0a0a0a", symbolColor: "#e4e4e7", height: 36,
    } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,  // cho phép renderer load file:// (thumbnail local)
    },
  });

  winState.manage(mainWindow);

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── App lifecycle ──────────────────────────────────────
app.whenReady().then(() => {
  // macOS dev: set dock icon (production build sẽ dùng .icns trong app bundle)
  if (process.platform === "darwin" && app.dock && isDev) {
    try {
      app.dock.setIcon(path.join(__dirname, "..", "build", "icons", "icon.png"));
    } catch {}
  }
  createWindow();
  // Init auto-updater sau khi mainWindow tạo xong để webContents.send hoạt động
  _loadUpdater(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── IPC handlers (bridge between React + native) ───────
ipcMain.handle("dialog:openFile", async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options.filters || [
      { name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] },
      { name: "Audio", extensions: ["wav", "mp3", "m4a", "flac"] },
      { name: "All Files", extensions: ["*"] },
    ],
    ...options,
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("dialog:saveFile", async (_event, options = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result.canceled ? null : result.filePath;
});

ipcMain.handle("app:getVersion", () => app.getVersion());
ipcMain.handle("app:getPlatform", () => process.platform);

ipcMain.handle("shell:openExternal", (_event, url) => shell.openExternal(url));

// Mở URL bằng Chrome (nếu cài), fallback default browser. Dùng cho flow
// "Đăng nhập để tải" — user click → app mở URL trong Chrome thật → login
// → Cmd+Q Chrome → quay lại VoxStudio thử lại.
ipcMain.handle("shell:openInChrome", async (_event, url) => {
  const { spawn } = await import("node:child_process");
  const fs = await import("node:fs/promises");
  const chromePaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ];
  for (const p of chromePaths) {
    try {
      await fs.access(p);
      spawn(p, [url], { detached: true, stdio: "ignore" }).unref();
      return "chrome";
    } catch {}
  }
  // Fallback: system default browser
  await shell.openExternal(url);
  return "default";
});

// Folder picker — trả về path absolute hoặc null khi hủy.
ipcMain.handle("dialog:pickFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Helper — tìm tên file unique trong folder. Nếu 'name.ext' đã tồn tại
// thì trả về 'name (1).ext', 'name (2).ext' …
async function _uniquePath(folder, filename) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(folder, filename);
  let i = 1;
  while (true) {
    try {
      await fs.access(candidate);
      // Tồn tại rồi → thử số khác
      candidate = path.join(folder, `${base} (${i})${ext}`);
      i += 1;
      if (i > 999) throw new Error("Too many duplicate filenames");
    } catch {
      return candidate;  // không tồn tại → OK
    }
  }
}

// Trả tên file unique cho renderer (để preview trong SaveAsModal)
ipcMain.handle("fs:getUniqueFilename", async (_event, { folder, filename }) => {
  return await _uniquePath(folder, filename);
});

// Download URL remote → lưu vào folder chỉ định. Nếu trùng tên, auto
// thêm (1), (2) vào tên trừ khi overwrite=true.
ipcMain.handle("fs:saveRemoteFile", async (_event, { url, folder, filename, overwrite }) => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = overwrite
    ? path.join(folder, filename)
    : await _uniquePath(folder, filename);
  await fs.writeFile(dest, buf);
  return dest;
});

// Liệt kê video trong thư mục local.
ipcMain.handle("fs:listVideosInFolder", async (_event, folder) => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const entries = await fs.readdir(folder);
  const videos = entries.filter((f) => /\.(mp4|mov|mkv|avi|webm)$/i.test(f));
  const out = [];
  for (const name of videos) {
    const full = path.join(folder, name);
    try {
      const s = await fs.stat(full);
      if (s.isFile()) out.push({ name, path: full, size: s.size });
    } catch {}
  }
  return out;
});

// Liệt kê media (audio + video) trong thư mục local — dùng cho STT batch.
ipcMain.handle("fs:listMediaInFolder", async (_event, folder) => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const entries = await fs.readdir(folder);
  const RE = /\.(mp4|mov|mkv|avi|webm|wav|mp3|m4a|flac|ogg|aac|wma|opus)$/i;
  const media = entries.filter((f) => RE.test(f));
  const out = [];
  for (const name of media) {
    const full = path.join(folder, name);
    try {
      const s = await fs.stat(full);
      if (s.isFile()) out.push({ name, path: full, size: s.size });
    } catch {}
  }
  return out;
});

// Ghi text file vào folder (SRT / VTT / TXT / JSON / CSV …).
// Auto-unique tên nếu trùng (trừ khi overwrite=true).
ipcMain.handle("fs:writeText", async (_event, { folder, filename, content, overwrite }) => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dest = overwrite
    ? path.join(folder, filename)
    : await _uniquePath(folder, filename);
  await fs.writeFile(dest, content, "utf8");
  return dest;
});

// Đọc file thành buffer để renderer wrap thành File và gửi lên backend.
ipcMain.handle("fs:readFileAsBuffer", async (_event, filepath) => {
  const fs = await import("node:fs/promises");
  return await fs.readFile(filepath);
});

// Mở file bằng ứng dụng mặc định của hệ điều hành
ipcMain.handle("shell:openFileInApp", async (_event, filepath) => {
  const err = await shell.openPath(filepath);
  if (err) throw new Error(err);
  return true;
});

// Hiện file trong Finder/Explorer
ipcMain.handle("shell:revealInFolder", async (_event, filepath) => {
  shell.showItemInFolder(filepath);
  return true;
});

// Custom window controls (Windows/Linux - Mac dùng traffic lights native)
ipcMain.handle("win:control", async (_event, action) => {
  if (!mainWindow) return;
  switch (action) {
    case "minimize":       mainWindow.minimize(); break;
    case "toggleMaximize": mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); break;
    case "close":          mainWindow.close(); break;
  }
});

// Native notification
ipcMain.handle("notify:show", async (_event, { title, body } = {}) => {
  if (!Notification.isSupported()) return false;
  new Notification({ title: title || "VoxStudio", body: body || "" }).show();
  return true;
});

// Dock / taskbar badge
ipcMain.handle("badge:set", async (_event, count) => {
  const n = Math.max(0, parseInt(count, 10) || 0);
  if (process.platform === "darwin" && app.dock) {
    app.dock.setBadge(n > 0 ? String(n) : "");
  } else if (mainWindow) {
    // Windows: setOverlayIcon cần icon file — hiện tại để null.
    try { mainWindow.setOverlayIcon(null, n > 0 ? `${n} đang chạy` : ""); } catch {}
  }
  return true;
});

// ── Secure API key vault (partitioned theo user) ───────
// Structure: { [userId]: { [keyId]: value } }
// Mã hoá toàn file bằng safeStorage (OS Keychain / DPAPI / libsecret).
// Fallback plain JSON nếu safeStorage không sẵn sàng.
//
// Renderer luôn gửi userId kèm mỗi call → vault đảm bảo user A không
// truy cập được key của user B trên cùng máy.
const _keyVaultPath = () => path.join(app.getPath("userData"), "keyvault.enc");

function _readVaultAll() {
  try {
    if (!fsSync.existsSync(_keyVaultPath())) return {};
    const buf = fsSync.readFileSync(_keyVaultPath());
    if (safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(buf));
    }
    return JSON.parse(buf.toString("utf8"));
  } catch (e) {
    console.warn("[keyvault] read failed:", e.message);
    return {};
  }
}

function _writeVaultAll(data) {
  try {
    const str = JSON.stringify(data);
    const buf = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(str)
      : Buffer.from(str, "utf8");
    fsSync.writeFileSync(_keyVaultPath(), buf, { mode: 0o600 });
    return true;
  } catch (e) {
    console.error("[keyvault] write failed:", e);
    return false;
  }
}

function _userBucket(userId) {
  if (!userId || typeof userId !== "string") return null;
  return String(userId);
}

ipcMain.handle("keys:list", async (_event, userId) => {
  const vault = _readVaultAll();
  const bucket = _userBucket(userId);
  const userKeys = (bucket && vault[bucket]) || {};
  const out = {};
  for (const k of Object.keys(userKeys)) out[k] = true;
  return {
    ids: out,
    encrypted: safeStorage.isEncryptionAvailable(),
  };
});

ipcMain.handle("keys:get", async (_event, { userId, id } = {}) => {
  if (!id || typeof id !== "string") return null;
  const bucket = _userBucket(userId);
  if (!bucket) return null;
  const vault = _readVaultAll();
  return vault[bucket]?.[id] || null;
});

ipcMain.handle("keys:set", async (_event, { userId, id, value } = {}) => {
  if (!id || typeof id !== "string") throw new Error("Invalid id");
  const bucket = _userBucket(userId);
  if (!bucket) throw new Error("Chưa đăng nhập — không thể lưu key");
  const vault = _readVaultAll();
  if (!vault[bucket]) vault[bucket] = {};
  if (value) vault[bucket][id] = value;
  else delete vault[bucket][id];
  // Cleanup empty bucket
  if (Object.keys(vault[bucket]).length === 0) delete vault[bucket];
  return _writeVaultAll(vault);
});

ipcMain.handle("keys:delete", async (_event, { userId, id } = {}) => {
  const bucket = _userBucket(userId);
  if (!bucket) return false;
  const vault = _readVaultAll();
  if (vault[bucket]) {
    delete vault[bucket][id];
    if (Object.keys(vault[bucket]).length === 0) delete vault[bucket];
  }
  return _writeVaultAll(vault);
});

// Xoá toàn bộ data của 1 user khi họ logout (clear sạch như user chọn
// trước đó). User khác không bị ảnh hưởng.
ipcMain.handle("keys:clearUser", async (_event, userId) => {
  const bucket = _userBucket(userId);
  if (!bucket) return false;
  const vault = _readVaultAll();
  delete vault[bucket];
  return _writeVaultAll(vault);
});

// Auto-update IPC
ipcMain.handle("updater:check", () => {
  if (_updaterApi) _updaterApi.checkForUpdates().catch(() => {});
});
ipcMain.handle("updater:quitAndInstall", () => {
  if (_updaterApi) _updaterApi.quitAndInstall(false, true);
});

// ── Local yt-dlp downloader ─────────────────────────────
// Tải video trên máy user (0 load server).
const _dl = require_("./downloader-local.cjs");
const _activeDownloads = new Map(); // id → { cancel }

ipcMain.handle("download:local:fetchInfo", async (_e, url) => {
  return _dl.fetchInfo(url);
});

ipcMain.handle("download:local:start", async (event, opts = {}) => {
  const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { promise, cancel } = _dl.download({
    ...opts,
    onProgress: (p) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("download:local:progress", { id, ...p });
        }
      } catch {}
    },
  });
  _activeDownloads.set(id, { cancel });
  // Không await — trả id ngay, kết quả gửi qua progress event
  promise
    .then((result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("download:local:progress",
          { id, step: "done", progress: 100, path: result?.path });
      }
    })
    .catch((e) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("download:local:progress",
          { id, step: "error", error: e?.message || String(e) });
      }
    })
    .finally(() => _activeDownloads.delete(id));
  return { id };
});

ipcMain.handle("download:local:cancel", async (_e, id) => {
  const entry = _activeDownloads.get(id);
  if (entry) {
    entry.cancel();
    _activeDownloads.delete(id);
    return true;
  }
  return false;
});

ipcMain.handle("download:local:status", () => ({
  ytdlp: _dl.resolveYtDlp().cmd,
  ffmpeg: _dl.resolveFfmpeg(),
  activeCount: _activeDownloads.size,
}));

// Menu (minimal, system-native feel)
const template = [
  ...(process.platform === "darwin"
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
      ]
    : []),
  {
    label: "File",
    submenu: [{ role: process.platform === "darwin" ? "close" : "quit" }],
  },
  { role: "editMenu" },
  { role: "viewMenu" },
  { role: "windowMenu" },
];
Menu.setApplicationMenu(Menu.buildFromTemplate(template));
