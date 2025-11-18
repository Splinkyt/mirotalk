// Central application state shared across modules
export const state = {
  socket: null,
  roomId: null,
  displayName: null,
  localStream: null,
  screenStream: null,
  compositeTrack: null,
  stopComposite: null,
  peers: new Map(), // peerId -> { pc, streams: { cam, screen }, videoEl }
  sharedPeerId: null,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};
