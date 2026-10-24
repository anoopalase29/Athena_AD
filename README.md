# myAthena Camera Check

A small React and Electron app that requests camera permission, displays a live preview, and offers an optional fullscreen mode. When several cameras are available, it remembers the selected camera locally for the next session. It does not start an assessment.

## Requirements

- Node.js and npm
- A working camera

## Setup

```sh
npm install
npm run dev
```

Open the local URL printed by Vite and select **Allow camera access**. Camera permission may need to be enabled in your browser or system settings.

To check the Electron desktop shell, first run `npm run build`, then run `npm start`.

## Checks

- `npm run lint`
- `npm run build`
