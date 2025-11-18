// Central application state shared across modules
export const state = {
  socket: null,
  // Optional handle to signaling wrapper returned by connectSignaling()
  signaling: null,
  roomId: null,
  displayName: null,
  localStream: null,
  screenStream: null,
  compositeTrack: null,
  stopComposite: null,
  peers: new Map(), // peerId -> { pc, videoEl, screenAudioSender, makingOffer, polite }
  sharedPeerId: null,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};
