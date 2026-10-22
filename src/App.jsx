import { useEffect, useRef, useState } from "react";
import "./App.css";

function App() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const openCamera = async (deviceId = "") => {
    setCameraError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
          : { width: 640, height: 480 },
        audio: false,
      });
      const previousStream = streamRef.current;
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
      previousStream?.getTracks().forEach((track) => track.stop());

      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || deviceId;
      setSelectedCameraId(activeDeviceId);
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

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#home" aria-label="Athena home">
          <span className="brand-mark">A</span>
          <span>athena</span>
        </a>
        <span className="header-caption">CAMERA CHECK</span>
      </header>

      <section className="setup-layout" aria-labelledby="setup-title">
        <div className="intro">
          <p className="eyebrow">CAMERA SETUP</p>
          <h1 id="setup-title">Check your camera.</h1>
          <p className="intro-copy">Allow camera access to see a live preview.</p>
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
        </div>
      </section>

      <footer className="site-footer">
        <span>myAthena</span>
        <span>Camera access can be turned off at any time.</span>
      </footer>
    </main>
  );
}

export default App;
