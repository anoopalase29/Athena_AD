import { useCallback, useEffect, useRef, useState } from "react";
import { electronBridge } from "./services/electronBridge";
import "./App.css";

const CAMERA_PREFERENCE_KEY = "myAthena.preferredCameraId";
const EXAM_DURATION_MINUTES = 60;
const PHOTO_INTERVAL_MS = 5000;

function readCameraPreference() {
  try {
    const deviceId = window.localStorage.getItem(CAMERA_PREFERENCE_KEY) || "";
    if (deviceId.length > 512) {
      window.localStorage.removeItem(CAMERA_PREFERENCE_KEY);
      return { deviceId: "", message: "A saved camera preference was invalid and has been cleared." };
    }
    return { deviceId, message: "" };
  } catch {
    return {
      deviceId: "",
      message: "Camera preferences are unavailable. Your choice will last for this session only.",
    };
  }
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const cameraRequestRef = useRef({ pending: false, generation: 0 });
  const startLockRef = useRef(false);
  const captureInProgressRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [fullScreenReady, setFullScreenReady] = useState(Boolean(document.fullscreenElement));
  const [fullScreenError, setFullScreenError] = useState("");
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraPreference, setCameraPreference] = useState(readCameraPreference);
  const [examState, setExamState] = useState("setup");
  const [timeLeftMs, setTimeLeftMs] = useState(EXAM_DURATION_MINUTES * 60 * 1000);
  const [showRules, setShowRules] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [rulesError, setRulesError] = useState("");

  const stopCamera = useCallback(() => {
    cameraRequestRef.current.generation += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  useEffect(() => () => {
    cameraRequestRef.current.generation += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraReady || !video || !stream) return undefined;

    video.srcObject = stream;
    const startPreview = () => {
      video.play().catch((error) => {
        console.error("Could not start camera preview:", error);
        setCameraError("Camera connected, but the preview could not start. Try turning the camera off and on again.");
      });
    };
    video.addEventListener("loadedmetadata", startPreview);
    if (video.readyState >= 1) startPreview();
    return () => video.removeEventListener("loadedmetadata", startPreview);
  }, [cameraReady, selectedCameraId]);

  useEffect(() => {
    const updateFullScreenState = () => {
      setFullScreenReady(Boolean(document.fullscreenElement));
      setFullScreenError("");
    };
    document.addEventListener("fullscreenchange", updateFullScreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullScreenState);
  }, []);

  useEffect(() => electronBridge.onFullScreenChange((isFullScreen) => {
    setFullScreenReady(Boolean(isFullScreen));
    setFullScreenError("");
  }), []);

  const saveCameraPreference = (deviceId, message = "") => {
    try {
      if (deviceId) window.localStorage.setItem(CAMERA_PREFERENCE_KEY, deviceId);
      else window.localStorage.removeItem(CAMERA_PREFERENCE_KEY);
      setCameraPreference({ deviceId, message });
    } catch {
      setCameraPreference({
        deviceId,
        message: "Could not save your camera choice. It will reset after restart.",
      });
    }
  };

  const openCamera = async (deviceId = "") => {
    if (cameraRequestRef.current.pending) return;
    cameraRequestRef.current.pending = true;
    const requestGeneration = cameraRequestRef.current.generation;
    setCameraError("");
    try {
      let requestedDeviceId = deviceId || cameraPreference.deviceId;
      let stream;
      let preferenceNotice = "";
      try {
        stream = await getCameraStream(requestedDeviceId);
      } catch (error) {
        const savedCameraMissing = !deviceId
          && cameraPreference.deviceId
          && ["NotFoundError", "OverconstrainedError", "DevicesNotFoundError"].includes(error.name);
        if (!savedCameraMissing) throw error;
        requestedDeviceId = "";
        preferenceNotice = "Your saved camera is unavailable. Using the default camera instead.";
        stream = await getCameraStream();
      }

      if (requestGeneration !== cameraRequestRef.current.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const previousStream = streamRef.current;
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
      previousStream?.getTracks().forEach((track) => track.stop());

      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || requestedDeviceId;
      setSelectedCameraId(activeDeviceId);
      saveCameraPreference(activeDeviceId, preferenceNotice);
      try {
        const videoDevices = await navigator.mediaDevices.enumerateDevices();
        setCameras(videoDevices.filter((device) => device.kind === "videoinput"));
      } catch {
        setCameras([]);
      }
    } catch (error) {
      if (requestGeneration === cameraRequestRef.current.generation) {
        setCameraError(streamRef.current
          ? "Could not switch to that camera. Your current camera is still active."
          : error.name === "NotAllowedError"
            ? "Camera permission was denied. Allow access in your browser or system settings and try again."
            : "The camera could not be opened. Check that it is connected and not in use by another app.");
      }
    } finally {
      cameraRequestRef.current.pending = false;
    }
  };

  const toggleFullScreen = async () => {
    setFullScreenError("");
    const result = await electronBridge.setFullScreen(!fullScreenReady);
    if (!result.success) {
      setFullScreenError(result.error || "Could not change full screen mode. Please try again.");
      return;
    }
    setFullScreenReady(Boolean(result.isFullScreen));
  };

  const startExam = async () => {
    if (startLockRef.current || examState !== "setup") return;
    startLockRef.current = true;
    setIsStarting(true);
    setStartError("");
    try {
      const result = await electronBridge.startTest(EXAM_DURATION_MINUTES);
      if (!result.success) throw new Error(result.error || "The exam could not be started.");
      setTimeLeftMs(Math.max(0, result.endTime - Date.now()));
      setExamState("inProgress");
      setRulesError("");
      setPhotoError(electronBridge.isElectron()
        ? ""
        : "Automatic photo saving is available in the Electron desktop app.");
    } catch (error) {
      startLockRef.current = false;
      setStartError(error.message || "The exam could not be started.");
    } finally {
      setIsStarting(false);
    }
  };

  const continueToRules = async () => {
    if (!cameraReady || !fullScreenReady || isStarting || examState !== "setup") return;
    setRulesError("");
    if (!electronBridge.isElectron()) {
      setShowRules(true);
      return;
    }

    setIsStarting(true);
    try {
      const result = await electronBridge.showRules();
      if (!result.success) throw new Error(result.error || "The exam rules dialog could not be displayed.");
      if (result.accepted) await startExam();
    } catch (error) {
      setRulesError(error.message || "The exam rules dialog could not be displayed.");
    } finally {
      setIsStarting(false);
    }
  };

  const finishExam = useCallback(() => {
    setShowFinishConfirm(false);
    setExamState("completed");
    stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (examState !== "inProgress") return undefined;
    let requestPending = false;
    const updateRemainingTime = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const remainingMs = Math.max(0, await electronBridge.getRemainingTime());
        setTimeLeftMs(remainingMs);
        if (remainingMs === 0) finishExam();
      } catch (error) {
        setStartError(error.message || "Could not read the remaining exam time.");
      } finally {
        requestPending = false;
      }
    };

    updateRemainingTime();
    const timerId = window.setInterval(updateRemainingTime, 1000);
    return () => window.clearInterval(timerId);
  }, [examState, finishExam]);

  useEffect(() => {
    if (examState !== "inProgress" || !cameraReady) return undefined;
    if (!electronBridge.isElectron()) return undefined;

    const capturePhoto = async () => {
      if (captureInProgressRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const stream = streamRef.current;
      if (!video || !canvas || !stream?.active || video.videoWidth === 0) return;

      captureInProgressRef.current = true;
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare the camera image.");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const result = await electronBridge.savePhoto(canvas.toDataURL("image/jpeg", 0.82));
        if (!result.success) throw new Error(result.error || "The camera photo could not be saved.");
        setPhotoError("");
      } catch (error) {
        console.error("Automatic exam photo failed:", error);
        setPhotoError(error.message || "An exam photo could not be captured or saved.");
      } finally {
        captureInProgressRef.current = false;
      }
    };

    const photoTimerId = window.setInterval(capturePhoto, PHOTO_INTERVAL_MS);
    return () => window.clearInterval(photoTimerId);
  }, [examState, cameraReady]);

  const acceptBrowserRules = async () => {
    setShowRules(false);
    await startExam();
  };

  return (
    <main className="app-shell">
      <canvas ref={canvasRef} className="capture-canvas" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#home" aria-label="Athena home">
          <span className="brand-mark">A</span>
          <span>athena</span>
        </a>
        <span className="header-caption">DEVICE CHECK</span>
      </header>

      {examState === "setup" && (
        <section className="setup-layout" aria-labelledby="setup-title">
          <div className="intro">
            <p className="eyebrow">DEVICE SETUP</p>
            <h1 id="setup-title">Get your setup ready.</h1>
            <p className="intro-copy">Connect your camera and enable full screen before starting.</p>
          </div>

          <div className="setup-card">
            <div className="step-row">
              <span className={`step-number ${cameraReady ? "step-done" : ""}`}>{cameraReady ? "✓" : "01"}</span>
              <div className="step-copy">
                <div className="step-heading">
                  <h2>Camera access</h2>
                  <span className={`status ${cameraReady ? "status-ready" : ""}`}>{cameraReady ? "Connected" : "Required"}</span>
                </div>
                <p>Your camera remains active during the exam for automatic verification photos.</p>
                <button className="button button-primary" type="button" onClick={cameraReady ? stopCamera : () => openCamera()}>
                  {cameraReady ? "Turn off camera" : "Allow camera access"}
                </button>
                {cameraPreference.message && <p className="preference-notice" role="status">{cameraPreference.message}</p>}
                {cameraError && <p className="inline-error" role="alert">{cameraError}</p>}
                {cameraReady && (
                  <>
                    {cameras.length > 1 && (
                      <div className="camera-selector">
                        <label htmlFor="camera-device">Camera device</label>
                        <select id="camera-device" value={selectedCameraId} onChange={(event) => openCamera(event.target.value)}>
                          {cameras.map((camera, index) => (
                            <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="video-frame">
                      <video ref={videoRef} autoPlay playsInline muted />
                      <span className="live-tag"><i /> LIVE PREVIEW</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="step-divider" />
            <div className="step-row">
              <span className={`step-number ${fullScreenReady ? "step-done" : ""}`}>{fullScreenReady ? "✓" : "02"}</span>
              <div className="step-copy">
                <div className="step-heading">
                  <h2>Full screen mode</h2>
                  <span className={`status ${fullScreenReady ? "status-ready" : ""}`}>{fullScreenReady ? "Enabled" : "Required"}</span>
                </div>
                <p>Keep the exam in full screen mode. You can still exit the app at any time.</p>
                <button className="button button-primary" type="button" onClick={toggleFullScreen}>
                  {fullScreenReady ? "Exit full screen" : "Enable full screen"}
                </button>
                {fullScreenError && <p className="inline-error" role="alert">{fullScreenError}</p>}
              </div>
            </div>
          </div>

          <div className="setup-footer">
            <span>{cameraReady && fullScreenReady ? "Your devices are ready." : "Camera and full screen are required."}</span>
            <button className="button button-primary" type="button" disabled={!cameraReady || !fullScreenReady || isStarting} onClick={continueToRules}>
              {isStarting ? "Checking rules…" : "Continue to exam"}
            </button>
          </div>
          {rulesError && <p className="inline-error" role="alert">{rulesError}</p>}
          {startError && <p className="inline-error" role="alert">{startError}</p>}
        </section>
      )}

      {examState === "inProgress" && (
        <section className="exam-session" aria-labelledby="exam-title">
          <p className="eyebrow">PROCTORED SESSION</p>
          <h1 id="exam-title">Exam in progress</h1>
          <div className="exam-timer" role="timer" aria-live="off">
            <span>TIME REMAINING</span>
            <strong>{formatRemainingTime(timeLeftMs)}</strong>
          </div>
          <p className="exam-session-copy">Your camera is active. Automatic verification photos are saved every five seconds.</p>
          {photoError && <p className="inline-error" role="alert">{photoError}</p>}
          {startError && <p className="inline-error" role="alert">{startError}</p>}
          <button className="button button-secondary" type="button" onClick={() => setShowFinishConfirm(true)}>Finish exam</button>
        </section>
      )}

      {examState === "completed" && (
        <section className="result-card" aria-labelledby="result-title">
          <span className="result-icon">✓</span>
          <p className="eyebrow">SESSION COMPLETE</p>
          <h1 id="result-title">Exam session ended.</h1>
          <p>Your timer and camera capture have stopped.</p>
          <div className="result-stats"><div><strong>{formatRemainingTime(timeLeftMs)}</strong><span>Time remaining</span></div></div>
          <button className="button button-primary" type="button" onClick={toggleFullScreen}>{fullScreenReady ? "Exit full screen" : "Return to full screen"}</button>
          {fullScreenError && <p className="inline-error" role="alert">{fullScreenError}</p>}
        </section>
      )}

      <footer className="site-footer">
        <span>myAthena</span>
        <span>Camera access can be turned off at any time.</span>
      </footer>

      {showRules && (
        <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRules(false); }}>
          <section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
            <p className="eyebrow">EXAM INSTRUCTIONS</p>
            <h2 id="rules-title">Please review the exam rules</h2>
            <ul>
              <li>Your webcam remains active for periodic verification photos.</li>
              <li>Keep the assessment in full screen mode.</li>
              <li>Do not switch tabs or use external resources.</li>
              <li>The exam has a 60-minute countdown.</li>
            </ul>
            <div className="modal-actions">
              <button className="button button-text" type="button" onClick={() => setShowRules(false)}>Cancel</button>
              <button className="button button-primary" type="button" onClick={acceptBrowserRules}>Accept &amp; Start Exam</button>
            </div>
          </section>
        </div>
      )}

      {showFinishConfirm && (
        <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowFinishConfirm(false); }}>
          <section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="finish-title">
            <p className="eyebrow">END SESSION</p>
            <h2 id="finish-title">Finish the exam now?</h2>
            <p className="intro-copy">The timer and camera snapshots will stop.</p>
            <div className="modal-actions">
              <button className="button button-text" type="button" onClick={() => setShowFinishConfirm(false)}>Continue exam</button>
              <button className="button button-primary" type="button" onClick={finishExam}>Finish exam</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

async function getCameraStream(deviceId = "") {
  return navigator.mediaDevices.getUserMedia({
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
      : { width: 640, height: 480 },
    audio: false,
  });
}

export default App;
