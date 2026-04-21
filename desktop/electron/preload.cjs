// Preload — exposes a safe API to the renderer (React) via window.voxstudio
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voxstudio", {
  // App info
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getPlatform: () => ipcRenderer.invoke("app:getPlatform"),

  // Native dialogs
  openFile: (options) => ipcRenderer.invoke("dialog:openFile", options),
  saveFile: (options) => ipcRenderer.invoke("dialog:saveFile", options),

  // External links (bypass window blocker)
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  // Folder picker + save remote file to folder (cho batch export)
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  saveRemoteFileToFolder: (opts) =>
    ipcRenderer.invoke("fs:saveRemoteFile", opts),
  listVideosInFolder: (folder) =>
    ipcRenderer.invoke("fs:listVideosInFolder", folder),
  readFileAsBuffer: (filepath) =>
    ipcRenderer.invoke("fs:readFileAsBuffer", filepath),
  openFileInApp: (filepath) =>
    ipcRenderer.invoke("shell:openFileInApp", filepath),
  revealFileInFolder: (filepath) =>
    ipcRenderer.invoke("shell:revealInFolder", filepath),

  // Custom window controls (Win/Linux) — Mac dùng traffic lights native
  winControl: (action) => ipcRenderer.invoke("win:control", action),

  // Native notification + dock/taskbar badge
  notify: (opts) => ipcRenderer.invoke("notify:show", opts),
  setBadge: (count) => ipcRenderer.invoke("badge:set", count),

  // Platform đồng bộ (để React render titlebar theo OS ngay lần đầu)
  platform: process.platform,

  // Ingest — chế độ "Trình duyệt": Electron main mở hidden BrowserWindow
  // intercept media URL (TikTok/FB/IG bypass anti-bot).
  ingest: {
    start: (opts) => ipcRenderer.invoke("ingest:start", opts),
    cancel: (jobId) => ipcRenderer.invoke("ingest:cancel", jobId),
    onProgress: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on("ingest:progress", h);
      return () => ipcRenderer.off("ingest:progress", h);
    },
    onDone: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on("ingest:done", h);
      return () => ipcRenderer.off("ingest:done", h);
    },
    onError: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on("ingest:error", h);
      return () => ipcRenderer.off("ingest:error", h);
    },
  },

  // Marker so React can detect Electron runtime
  isElectron: true,
});
