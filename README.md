# MiroTalk WebRTC (MVP)

A minimal custom WebRTC app for video/audio calls and screen sharing. Uses Express to serve a static client and Socket.IO for signaling — no database, rooms are kept in memory.

## Features
- Join a room and connect with peers (Socket.IO signaling)
- Video/audio call controls (toggle cam/mic)
- Screen share (start/stop, fullscreen)
- In-room chat
- Health check at `/health`

## Quick start
Prerequisites: Node.js 18+

```bash
npm install
npm start
# Open http://localhost:3000
# Enter a Room ID (e.g., "demo") and share the link with others
```

Env vars:
- `PORT` (default: 3000)

## Docker
```bash
docker build -t mirotalk .
docker run --rm -p 3000:3000 mirotalk
```

## Project layout
- `app/server.js` — Express + Socket.IO signaling server
- `public/` — Static client
  - `index.html` — UI
  - `js/` — ES modules (no bundler)
    - `app/` — app wiring
      - `main.js` — entry point imported by `index.html`
      - `init.js` — initializes the app
    - `core/` — shared helpers
      - `state.js` — central app state
      - `dom.js` — DOM helpers (e.g., `$`)
      - `logger.js` — prefixed logging
    - `signaling/` — Socket.IO wrapper (`socket.js`)
    - `rtc/` — WebRTC peer management (`peerManager.js`)
    - `media/` — media utilities (`localMedia.js`, `screenShare.js`, `pipComposer.js`, `audioUnlock.js`)
    - `ui/` — UI modules (`chat.js`)
- `Dockerfile` — Minimal production image

Notes:
- The client uses native ES module imports; no bundler is required.
- Autoplay and iOS/Safari: videos use `playsInline`, and an explicit enable‑audio button is shown when the browser blocks autoplay with sound.

## License
MIT (or your preferred license)