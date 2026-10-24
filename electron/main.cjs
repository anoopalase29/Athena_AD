const { app, BrowserWindow, dialog, ipcMain, session, systemPreferences } = require("electron");
const fs = require("fs");
const path = require("path");

const EXAM_DURATION_MS = 60 * 60 * 1000;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
let win;
let examEndTime = 0;
let examStarted = false;
let rulesAccepted = false;

function isAppWindow(event) {
  return win && !win.isDestroyed() && event.sender === win.webContents;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on("closed", () => { win = null; });
  win.on("enter-full-screen", () => win?.webContents.send("full-screen-changed", true));
  win.on("leave-full-screen", () => win?.webContents.send("full-screen-changed", false));

  win.loadURL("http://localhost:5173/").catch(() => {
    const buildPath = path.join(__dirname, "../dist/index.html");
    if (fs.existsSync(buildPath)) win?.loadFile(buildPath);
  });
}

function configurePermissions() {
  const isAllowed = (webContents, permission, details) => {
    if (webContents !== win?.webContents) return false;
    if (permission === "fullscreen") return true;
    return permission === "media"
      && details?.mediaTypes?.includes("video")
      && !details.mediaTypes.includes("audio");
  };

  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    isAllowed(webContents, permission, details)
  );

  session.defaultSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    if (!isAllowed(webContents, permission, details)) return callback(false);
    if (permission === "fullscreen") return callback(true);
    if (process.platform !== "darwin") return callback(true);

    try {
      callback(await systemPreferences.askForMediaAccess("camera"));
    } catch (error) {
      console.error("Could not request camera access:", error);
      callback(false);
    }
  });
}

function registerIpcHandlers() {
  ipcMain.handle("full-screen", (event, enabled) => {
    if (!isAppWindow(event) || typeof enabled !== "boolean") {
      return { success: false, error: "Could not change fullscreen mode." };
    }
    try {
      win.setFullScreen(enabled);
      return { success: true, isFullScreen: win.isFullScreen() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("show-rules", async (event) => {
    if (!isAppWindow(event)) return { success: false, accepted: false, error: "App window is unavailable." };
    try {
      const result = await dialog.showMessageBox(win, {
        type: "info",
        title: "Exam rules",
        message: "Please follow these rules:",
        detail: "1. Webcam snapshots are taken during the exam.\n2. Keep the exam in fullscreen.\n3. Do not switch tabs or use external resources.\n4. The exam lasts 60 minutes.",
        buttons: ["Accept & Start Exam", "Cancel"],
        cancelId: 1,
        defaultId: 0,
      });
      rulesAccepted = result.response === 0;
      return { success: true, accepted: rulesAccepted };
    } catch (error) {
      return { success: false, accepted: false, error: error.message };
    }
  });

  ipcMain.handle("start-test", (event) => {
    if (!isAppWindow(event) || !rulesAccepted || examStarted) {
      return { success: false, error: "Accept the rules before starting the exam." };
    }
    examStarted = true;
    examEndTime = Date.now() + EXAM_DURATION_MS;
    return { success: true, endTime: examEndTime };
  });

  ipcMain.handle("get-time", (event) =>
    isAppWindow(event) ? Math.max(0, examEndTime - Date.now()) : 0
  );

  ipcMain.handle("save-photo", async (event, dataUrl) => {
    if (!isAppWindow(event) || !examStarted || Date.now() >= examEndTime) {
      return { success: false, error: "Photos can only be saved during the exam." };
    }
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/jpeg;base64,")) {
      return { success: false, error: "Photo must be a JPEG image." };
    }

    try {
      const image = Buffer.from(dataUrl.slice("data:image/jpeg;base64,".length), "base64");
      if (image.length > MAX_PHOTO_BYTES || image[0] !== 0xff || image[1] !== 0xd8
        || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
        return { success: false, error: "Photo data is invalid or too large." };
      }
      const folder = path.join(app.getPath("userData"), "cameraFeed");
      await fs.promises.mkdir(folder, { recursive: true });
      const fileName = `snapshot-${Date.now()}.jpg`;
      await fs.promises.writeFile(path.join(folder, fileName), image);
      return { success: true, fileName };
    } catch (error) {
      console.error("Could not save exam photo:", error);
      return { success: false, error: "Could not save the camera snapshot." };
    }
  });
}

app.whenReady().then(() => {
  configurePermissions();
  registerIpcHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
