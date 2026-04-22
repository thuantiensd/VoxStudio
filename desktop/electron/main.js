import { app, BrowserWindow, Menu, shell, ipcMain, dialog, Notification, safeStorage } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fsSync from "node:fs";
import windowStateKeeper from "electron-window-state";

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

  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: 1024,
    minHeight: 640,
    title: "VoxStudio",
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
  createWindow();

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

// ── Secure API key vault ───────────────────────────────
// Lưu các API key (OpenAI / Claude / DeepL / Gemini / Google Cloud) được
// mã hoá bởi safeStorage (OS Keychain / DPAPI / libsecret). Fallback plain
// JSON nếu safeStorage chưa sẵn sàng (Linux không có keyring) — kèm cảnh báo.
const _keyVaultPath = () => path.join(app.getPath("userData"), "keyvault.enc");

function _readVault() {
  try {
    if (!fsSync.existsSync(_keyVaultPath())) return {};
    const buf = fsSync.readFileSync(_keyVaultPath());
    if (safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(buf));
    }
    // Fallback: file utf8 JSON plain (chỉ Linux headless)
    return JSON.parse(buf.toString("utf8"));
  } catch (e) {
    console.warn("[keyvault] read failed:", e.message);
    return {};
  }
}

function _writeVault(data) {
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

ipcMain.handle("keys:list", async () => {
  // Trả về các id có key (không trả value) + trạng thái mã hoá
  const vault = _readVault();
  const out = {};
  for (const k of Object.keys(vault)) out[k] = true;
  return {
    ids: out,
    encrypted: safeStorage.isEncryptionAvailable(),
  };
});

ipcMain.handle("keys:get", async (_event, id) => {
  if (!id || typeof id !== "string") return null;
  const vault = _readVault();
  return vault[id] || null;
});

ipcMain.handle("keys:set", async (_event, { id, value }) => {
  if (!id || typeof id !== "string") throw new Error("Invalid id");
  const vault = _readVault();
  if (value) vault[id] = value;
  else delete vault[id];
  return _writeVault(vault);
});

ipcMain.handle("keys:delete", async (_event, id) => {
  const vault = _readVault();
  delete vault[id];
  return _writeVault(vault);
});

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
