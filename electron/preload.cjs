const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  setFullScreen: (enabled) => ipcRenderer.invoke("full-screen", enabled),
  showRules: () => ipcRenderer.invoke("show-rules"),
  startTest: (durationMinutes) => ipcRenderer.invoke("start-test", durationMinutes),
  getRemainingTime: () => ipcRenderer.invoke("get-time"),
  savePhoto: (payload) => ipcRenderer.invoke("save-photo", payload),
  onFullScreenChange: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, isFullScreen) => callback(isFullScreen);
    ipcRenderer.on("full-screen-changed", listener);
    return () => ipcRenderer.removeListener("full-screen-changed", listener);
  },
});
