# myAthena Exam Session

A React and Electron application for preparing a camera, reviewing exam rules, and running a 60-minute monitored session. It supports a live camera preview, optional camera selection saved locally, a fullscreen setup check, a native Electron rules dialog, and automatic JPEG snapshots every five seconds during an active desktop session. Snapshots are stored in Electron's `userData/cameraFeed` directory.

The repository does not currently include exam questions or answer workflows, so the session provides the timer and camera monitoring flow only.

## Requirements

- Node.js and npm
- A working camera

## Setup

```sh
npm install
npm run dev
```

Open the local URL printed by Vite and select **Allow camera access**. Browser mode supports the setup, rules, and timer flow; automatic photo saving requires Electron.

To run the Electron desktop app, start Vite in one terminal with `npm run dev`, then run `npm start` in another. Electron requests camera access and uses a native rules dialog before starting the session.

## Checks

- `npm run lint`
- `npm run build`
