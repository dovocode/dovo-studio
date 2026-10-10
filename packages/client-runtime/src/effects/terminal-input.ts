/** Stay below both terminal schema and WebSocket byte limits, even for JSON-escaped input. */
export function terminalInputFrames(data: string): Array<{ type: 'input'; data: string }> {
  const frames: Array<{ type: 'input'; data: string }> = []
  for (let start = 0; start < data.length;) {
    let end = Math.min(start + 16 * 1024, data.length)
    const last = data.charCodeAt(end - 1)
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end--
    frames.push({ type: 'input', data: data.slice(start, end) })
    start = end
  }
  return frames
}
