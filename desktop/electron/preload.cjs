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
  openInChrome: (url) => ipcRenderer.invoke("shell:openInChrome", url),

  // Folder picker + save remote file to folder (cho batch export)
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  saveRemoteFileToFolder: (opts) =>
    ipcRenderer.invoke("fs:saveRemoteFile", opts),
  getUniqueFilename: (opts) =>
    ipcRenderer.invoke("fs:getUniqueFilename", opts),
  listVideosInFolder: (folder) =>
    ipcRenderer.invoke("fs:listVideosInFolder", folder),
  listMediaInFolder: (folder) =>
    ipcRenderer.invoke("fs:listMediaInFolder", folder),
  writeText: (opts) =>
    ipcRenderer.invoke("fs:writeText", opts),
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

  // Local downloader (yt-dlp chạy trên máy user, không qua server)
  downloader: {
    fetchInfo: (url) => ipcRenderer.invoke("download:local:fetchInfo", url),
    start: (opts) => ipcRenderer.invoke("download:local:start", opts),
    cancel: (id) => ipcRenderer.invoke("download:local:cancel", id),
    status: () => ipcRenderer.invoke("download:local:status"),
    onProgress: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on("download:local:progress", listener);
      return () => ipcRenderer.removeListener("download:local:progress", listener);
    },
  },

  // Auto-update
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    quitAndInstall: () => ipcRenderer.invoke("updater:quitAndInstall"),
    onEvent: (channel, cb) => {
      // channel: 'update:checking' | 'update:available' | 'update:not-available'
      //          | 'update:progress' | 'update:downloaded' | 'update:error'
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },

  // Secure API key vault — partition theo userId (mỗi user riêng bucket).
  // Renderer PHẢI gửi userId. Nếu không, main process refuse.
  keys: {
    list:   (userId) => ipcRenderer.invoke("keys:list", userId),
    get:    (userId, id) => ipcRenderer.invoke("keys:get", { userId, id }),
    set:    (userId, id, value) => ipcRenderer.invoke("keys:set", { userId, id, value }),
    delete: (userId, id) => ipcRenderer.invoke("keys:delete", { userId, id }),
    clearUser: (userId) => ipcRenderer.invoke("keys:clearUser", userId),
  },

  // Platform đồng bộ (để React render titlebar theo OS ngay lần đầu)
  platform: process.platform,

  // Marker so React can detect Electron runtime
  isElectron: true,
});
