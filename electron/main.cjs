const { BrowserWindow, app, session, systemPreferences } = require("electron");
const path = require("path");
const fs = require("fs");

let win = null;

function isAppUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === "file:" || url.origin === "http://localhost:5173";
  } catch {
    return false;
  }
}

function isAllowedPermission(webContents, permission, details) {
  const requestingUrl = details?.requestingUrl || webContents?.getURL();
  if (!isAppUrl(requestingUrl)) return false;
  if (permission === "fullscreen") return true;
  return permission === "media"
    && details?.mediaTypes?.includes("video")
    && !details.mediaTypes.includes("audio");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = "http://localhost:5173/";
  win.loadURL(devUrl).catch(() => {
    // If dev server is not running, load production build if available
    const indexPath = path.join(__dirname, "../dist/index.html");
    if (fs.existsSync(indexPath)) {
      win.loadFile(indexPath);
    }
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    isAllowedPermission(webContents, permission, details)
  );

  session.defaultSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    if (!isAllowedPermission(webContents, permission, details)) {
      callback(false);
      return;
    }

    if (permission === "fullscreen") {
      callback(true);
      return;
    }

    if (process.platform === "darwin") {
      try {
        callback(await systemPreferences.askForMediaAccess("camera"));
      } catch (error) {
        console.error("Could not request macOS camera access:", error);
        callback(false);
      }
      return;
    }

    callback(true);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
