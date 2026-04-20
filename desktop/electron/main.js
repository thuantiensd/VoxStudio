import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
const VITE_DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5174";

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "VoxStudio",
    backgroundColor: "#0b1120", // dark navy matching theme
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,  // cho phép renderer load file:// (dùng cho thumbnail local)
    },
  });

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

// Folder picker — trả về path absolute hoặc null khi hủy.
ipcMain.handle("dialog:pickFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Download URL remote → lưu vào folder chỉ định.
ipcMain.handle("fs:saveRemoteFile", async (_event, { url, folder, filename }) => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = path.join(folder, filename);
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
