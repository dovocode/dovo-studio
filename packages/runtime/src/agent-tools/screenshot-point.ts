export function screenshotPoint(
  image: string,
  screen: { width: number; height: number },
  x: number,
  y: number,
) {
  const png = Buffer.from(image.replace(/^data:image\/png;base64,/, ''), 'base64')
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('Simulator screenshot is not a PNG')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (!width || !height) throw new Error('Simulator screenshot has invalid dimensions')
  const landscape = width > height
  const pointsWidth = landscape
    ? Math.max(screen.width, screen.height)
    : Math.min(screen.width, screen.height)
  const pointsHeight = landscape
    ? Math.min(screen.width, screen.height)
    : Math.max(screen.width, screen.height)
  return { x: (x * pointsWidth) / width, y: (y * pointsHeight) / height }
}
