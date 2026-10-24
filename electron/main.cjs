const { BrowserWindow, app, dialog, ipcMain, session, systemPreferences } = require("electron");
const fs = require("fs");
const path = require("path");
const { fileURLToPath } = require("url");

const EXAM_DURATION_MINUTES = 60;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
let win = null;
let examEndTime = null;
let examStarted = false;
let rulesAccepted = false;

function isAppUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol === "file:") {
      return path.resolve(fileURLToPath(url)) === path.resolve(__dirname, "../dist/index.html");
    }
    return url.origin === "http://localhost:5173";
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

function isTrustedSender(event) {
  return isAppUrl(event.senderFrame?.url || event.sender.getURL());
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

  const devUrl = "http://localhost:5173/";
  win.loadURL(devUrl).catch(() => {
    const indexPath = path.join(__dirname, "../dist/index.html");
    if (fs.existsSync(indexPath)) win.loadFile(indexPath);
  });
}

function configurePermissions() {
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
}

function registerIpcHandlers() {
  ipcMain.handle("full-screen", (event, enabled) => {
    if (!isTrustedSender(event)) return { success: false, isFullScreen: false, error: "Untrusted app window." };
    if (typeof enabled !== "boolean") return { success: false, isFullScreen: false, error: "Fullscreen state must be true or false." };
    if (!win || win.isDestroyed()) return { success: false, isFullScreen: false, error: "App window is unavailable." };
    try {
      win.setFullScreen(enabled);
      return { success: true, isFullScreen: win.isFullScreen() };
    } catch (error) {
      return { success: false, isFullScreen: win.isFullScreen(), error: error.message };
    }
  });

  ipcMain.handle("show-rules", async (event) => {
    if (!isTrustedSender(event)) return { success: false, accepted: false, error: "Untrusted app window." };
    if (!win || win.isDestroyed()) return { success: false, accepted: false, error: "App window is unavailable." };
    try {
      const result = await dialog.showMessageBox(win, {
        type: "info",
        title: "Exam Instructions & Proctoring Rules",
        message: "Please read and accept the assessment terms:",
        detail:
          "1. Webcam monitoring remains active for automatic verification snapshots.\n" +
          "2. The assessment must be taken in full screen mode.\n" +
          "3. Tab switching, minimizing, or external resources are prohibited.\n" +
          "4. The session has an enforced 60-minute countdown.",
        buttons: ["Accept & Start Exam", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      rulesAccepted = result.response === 0;
      return { success: true, accepted: rulesAccepted };
    } catch (error) {
      console.error("Could not display exam rules:", error);
      return { success: false, accepted: false, error: error.message };
    }
  });

  ipcMain.handle("start-test", (event, durationMinutes = EXAM_DURATION_MINUTES) => {
    if (!isTrustedSender(event)) return { success: false, error: "Untrusted app window." };
    if (!rulesAccepted) return { success: false, error: "Accept the exam rules before starting." };
    if (examStarted) return { success: false, error: "This exam session has already been started." };
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 60) {
      return { success: false, error: "Exam duration must be between 1 and 60 minutes." };
    }
    examStarted = true;
    examEndTime = Date.now() + durationMinutes * 60 * 1000;
    return { success: true, endTime: examEndTime, durationMs: durationMinutes * 60 * 1000 };
  });

  ipcMain.handle("get-time", (event) => {
    if (!isTrustedSender(event)) return 0;
    return examEndTime ? Math.max(0, examEndTime - Date.now()) : 0;
  });

  ipcMain.handle("save-photo", async (event, payload) => {
    if (!isTrustedSender(event)) return { success: false, error: "Untrusted app window." };
    if (!examStarted || !examEndTime || Date.now() >= examEndTime) {
      return { success: false, error: "Photos can only be saved during an active exam." };
    }
    if (typeof payload !== "string") return { success: false, error: "Photo data must be a JPEG data URL." };
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload);
    if (!match || match[1].length > Math.ceil(MAX_PHOTO_BYTES * 4 / 3)) {
      return { success: false, error: "Photo data is invalid or too large." };
    }

    try {
      const imageBuffer = Buffer.from(match[1], "base64");
      if (!imageBuffer.length || imageBuffer.length > MAX_PHOTO_BYTES
        || imageBuffer[0] !== 0xff || imageBuffer[1] !== 0xd8
        || imageBuffer[imageBuffer.length - 2] !== 0xff || imageBuffer[imageBuffer.length - 1] !== 0xd9) {
        return { success: false, error: "Photo data is not a valid JPEG image." };
      }
      const photoDirectory = path.join(app.getPath("userData"), "cameraFeed");
      await fs.promises.mkdir(photoDirectory, { recursive: true });
      const fileName = `snapshot-${Date.now()}.jpg`;
      await fs.promises.writeFile(path.join(photoDirectory, fileName), imageBuffer, { flag: "wx" });
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
