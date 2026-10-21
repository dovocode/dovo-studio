const disabled = () => {
  throw new Error('Native peer transport is disabled in the browser catalog')
}
export const preparePeerConnection = disabled
export const replacePeerConnection = disabled
export const forgetPeerConnection = disabled
export const closePeerConnections = disabled
export const setPeerConnectionsActive = disabled
export const setPeerConnectionNetwork = disabled
export const peerConnectionVersion = () => 0
export const subscribePeerConnections = () => () => undefined
export const peerConnectionReady = () => false
export const peerConnectionRoute = () => undefined
