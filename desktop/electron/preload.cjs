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

  // Secure API key vault (safeStorage / OS Keychain)
  keys: {
    list:   () => ipcRenderer.invoke("keys:list"),
    get:    (id) => ipcRenderer.invoke("keys:get", id),
    set:    (id, value) => ipcRenderer.invoke("keys:set", { id, value }),
    delete: (id) => ipcRenderer.invoke("keys:delete", id),
  },

  // Platform đồng bộ (để React render titlebar theo OS ngay lần đầu)
  platform: process.platform,

  // Marker so React can detect Electron runtime
  isElectron: true,
});
