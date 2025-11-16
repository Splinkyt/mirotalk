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
- `public/` — Static client (`index.html`, `main.js`)
- `Dockerfile` — Minimal production image

## License
MIT (or your preferred license)