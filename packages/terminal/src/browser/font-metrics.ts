/** Keep font rasterization and cell placement on the same device-pixel grid. */
export function measureTerminalFont(
  context: OffscreenCanvasRenderingContext2D,
  fontFamily: string,
  fontSize: number,
  ratio: number,
) {
  context.font = `${fontSize}px ${fontFamily}`
  const width = context.measureText('M').width
  const bounds = context.measureText('Mg')
  const ascent = bounds.fontBoundingBoxAscent || bounds.actualBoundingBoxAscent || fontSize
  const descent = bounds.fontBoundingBoxDescent || bounds.actualBoundingBoxDescent || 0
  const height = Math.max(Math.ceil(fontSize * 1.3 * ratio), Math.ceil((ascent + descent) * ratio))
  return {
    cellWidth: Math.max(1, Math.ceil(width * ratio)) / ratio,
    cellHeight: height / ratio,
    baseline: Math.round((height - (ascent + descent) * ratio) / 2 + ascent * ratio) / ratio,
  }
}
