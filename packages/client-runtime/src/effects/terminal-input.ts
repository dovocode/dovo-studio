type InputFrame = { type: 'input'; data: string; paste?: 'start' | 'continue' | 'end' }

/** Stay below both terminal schema and WebSocket byte limits, even for JSON-escaped input. */
export function terminalInputFrames(data: string, paste = false): InputFrame[] {
  const frames: InputFrame[] = []
  for (let start = 0; start < data.length;) {
    let end = Math.min(start + 16 * 1024, data.length)
    const last = data.charCodeAt(end - 1)
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--
    frames.push({ type: 'input', data: data.slice(start, end) })
    start = end
  }
  if (paste && frames.length > 1) {
    for (const frame of frames) frame.paste = 'continue'
    frames[0]!.paste = 'start'
    frames[frames.length - 1]!.paste = 'end'
  }
  return frames
}
