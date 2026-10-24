let webEndTime = null;
let webExamStarted = false;

export const electronBridge = {
  isElectron: () => Boolean(typeof window !== "undefined" && window.electronAPI?.isElectron),

  setFullScreen: async (enabled) => {
    if (typeof window !== "undefined" && window.electronAPI?.setFullScreen) {
      return window.electronAPI.setFullScreen(enabled);
    }

    try {
      if (enabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (!enabled && document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (enabled && !document.documentElement.requestFullscreen) {
        throw new Error("Fullscreen is not supported by this browser.");
      }
      return { success: true, isFullScreen: Boolean(document.fullscreenElement) };
    } catch (error) {
      return { success: false, isFullScreen: Boolean(document.fullscreenElement), error: error.message };
    }
  },

  onFullScreenChange: (callback) => {
    if (typeof window !== "undefined" && window.electronAPI?.onFullScreenChange) {
      return window.electronAPI.onFullScreenChange(callback);
    }
    return () => {};
  },

  showRules: async () => {
    if (typeof window !== "undefined" && window.electronAPI?.showRules) {
      return window.electronAPI.showRules();
    }
    return { success: false, accepted: false, error: "Use the in-app rules dialog." };
  },

  startTest: async (durationMinutes) => {
    if (typeof window !== "undefined" && window.electronAPI?.startTest) {
      return window.electronAPI.startTest(durationMinutes);
    }
    if (webExamStarted) return { success: false, error: "This exam session has already been started." };
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 60) {
      return { success: false, error: "Exam duration must be between 1 and 60 minutes." };
    }
    webExamStarted = true;
    webEndTime = Date.now() + durationMinutes * 60 * 1000;
    return { success: true, endTime: webEndTime, durationMs: durationMinutes * 60 * 1000 };
  },

  getRemainingTime: async () => {
    if (typeof window !== "undefined" && window.electronAPI?.getRemainingTime) {
      return window.electronAPI.getRemainingTime();
    }
    return webEndTime ? Math.max(0, webEndTime - Date.now()) : 0;
  },

  savePhoto: async (payload) => {
    if (typeof window !== "undefined" && window.electronAPI?.savePhoto) {
      return window.electronAPI.savePhoto(payload);
    }
    return { success: false, error: "Photo saving requires the Electron desktop app." };
  },
};
