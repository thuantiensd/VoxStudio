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

  // Marker so React can detect Electron runtime
  isElectron: true,
});
