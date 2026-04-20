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

  // Marker so React can detect Electron runtime
  isElectron: true,
});
