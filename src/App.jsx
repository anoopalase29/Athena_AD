import { useEffect, useRef, useState } from "react";
import "./App.css";

const CAMERA_PREFERENCE_KEY = "myAthena.preferredCameraId";

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

function App() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [fullScreenReady, setFullScreenReady] = useState(Boolean(document.fullscreenElement));
  const [fullScreenError, setFullScreenError] = useState("");
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraPreference, setCameraPreference] = useState(readCameraPreference);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  };

  useEffect(() => () => {
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

  const saveCameraPreference = (deviceId, message = "") => {
    try {
      if (deviceId) {
        window.localStorage.setItem(CAMERA_PREFERENCE_KEY, deviceId);
      } else {
        window.localStorage.removeItem(CAMERA_PREFERENCE_KEY);
      }
      setCameraPreference({ deviceId, message });
    } catch {
      setCameraPreference({
        deviceId,
        message: "Could not save your camera choice. It will reset after restart.",
      });
    }
  };

  const openCamera = async (deviceId = "") => {
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
      if (streamRef.current) {
        setCameraError("Could not switch to that camera. Your current camera is still active.");
      } else {
        setCameraError(
          error.name === "NotAllowedError"
            ? "Camera permission was denied. Allow access in your browser or system settings and try again."
            : "The camera could not be opened. Check that it is connected and not in use by another app."
        );
      }
    }
  };

  const toggleFullScreen = async () => {
    setFullScreenError("");
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else {
        throw new Error("Fullscreen is not supported by this window.");
      }
    } catch (error) {
      setFullScreenError(error.message || "Could not change full screen mode. Please try again.");
    }
  };

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#home" aria-label="Athena home">
          <span className="brand-mark">A</span>
          <span>athena</span>
        </a>
        <span className="header-caption">DEVICE CHECK</span>
      </header>

      <section className="setup-layout" aria-labelledby="setup-title">
        <div className="intro">
          <p className="eyebrow">DEVICE SETUP</p>
          <h1 id="setup-title">Get your setup ready.</h1>
          <p className="intro-copy">Check your camera and choose whether to use full screen.</p>
        </div>

        <div className="setup-card">
          <div className="step-row">
            <span className={`step-number ${cameraReady ? "step-done" : ""}`}>
              {cameraReady ? "✓" : "01"}
            </span>
            <div className="step-copy">
              <div className="step-heading">
                <h2>Camera access</h2>
                <span className={`status ${cameraReady ? "status-ready" : ""}`}>
                  {cameraReady ? "Connected" : "Not connected"}
                </span>
              </div>
              <p>Your camera will only be used to show this preview.</p>
              <button
                className="button button-primary"
                type="button"
                onClick={cameraReady ? stopCamera : () => openCamera()}
              >
                {cameraReady ? "Turn off camera" : "Allow camera access"}
              </button>
              {cameraPreference.message && (
                <p className="preference-notice" role="status">{cameraPreference.message}</p>
              )}
              {cameraError && <p className="inline-error" role="alert">{cameraError}</p>}
              {cameraReady && (
                <>
                  {cameras.length > 1 && (
                    <div className="camera-selector">
                      <label htmlFor="camera-device">Camera device</label>
                      <select
                        id="camera-device"
                        value={selectedCameraId}
                        onChange={(event) => openCamera(event.target.value)}
                      >
                        {cameras.map((camera, index) => (
                          <option key={camera.deviceId} value={camera.deviceId}>
                            {camera.label || `Camera ${index + 1}`}
                          </option>
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
            <span className={`step-number ${fullScreenReady ? "step-done" : ""}`}>
              {fullScreenReady ? "✓" : "02"}
            </span>
            <div className="step-copy">
              <div className="step-heading">
                <h2>Full screen mode</h2>
                <span className={`status ${fullScreenReady ? "status-ready" : ""}`}>
                  {fullScreenReady ? "Enabled" : "Optional"}
                </span>
              </div>
              <p>Expand the app to fill your screen. You can exit full screen at any time.</p>
              <button className="button button-primary" type="button" onClick={toggleFullScreen}>
                {fullScreenReady ? "Exit full screen" : "Enable full screen"}
              </button>
              {fullScreenError && <p className="inline-error" role="alert">{fullScreenError}</p>}
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>myAthena</span>
        <span>Camera access can be turned off at any time.</span>
      </footer>
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
