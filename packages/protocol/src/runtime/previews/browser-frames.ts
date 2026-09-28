// Opt-in binary browser transport v1: sequence, CSS width, CSS height (uint32 BE), JPEG.
// Keep the JSON frame protocol for clients that have not updated yet.
export function encodeBrowserFrame(
  frame: { width: number; height: number; data: Uint8Array },
  sequence: number,
) {
  const packet = new Uint8Array(12 + frame.data.byteLength)
  const header = new DataView(packet.buffer)
  header.setUint32(0, sequence)
  header.setUint32(4, frame.width)
  header.setUint32(8, frame.height)
  packet.set(frame.data, 12)
  return packet
}

export function decodeBrowserFrame(packet: ArrayBuffer) {
  if (packet.byteLength <= 12 || packet.byteLength > 16 * 1024 * 1024)
    throw new Error('Invalid browser frame size')
  const header = new DataView(packet)
  const sequence = header.getUint32(0)
  const width = header.getUint32(4)
  const height = header.getUint32(8)
  if (!sequence || width < 240 || height < 240 || width > 1920 || height > 1920)
    throw new Error('Invalid browser frame dimensions')
  return { sequence, width, height, data: new Uint8Array(packet, 12) }
}
