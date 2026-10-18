export type Point = { x: number; y: number }
export type Bounds = Point & { width: number; height: number }
export type DrawingTool = 'pen' | 'highlight' | 'arrow' | 'rectangle'
export type ImageTool = DrawingTool | 'crop'
export type Mark = { tool: DrawingTool; points: Point[]; color: string; width: number }
export type ImageEdit = { crop: Bounds; marks: Mark[] }
export type EditHistory = { steps: ImageEdit[]; index: number }
export type EditAction = { type: 'commit'; edit: ImageEdit } | { type: 'undo' | 'redo' | 'reset' }

export function editHistory(history: EditHistory, action: EditAction): EditHistory {
  switch (action.type) {
    case 'commit':
      return {
        steps: [...history.steps.slice(0, history.index + 1), action.edit],
        index: history.index + 1,
      }
    case 'undo':
      return { ...history, index: Math.max(0, history.index - 1) }
    case 'redo':
      return { ...history, index: Math.min(history.steps.length - 1, history.index + 1) }
    case 'reset':
      return { steps: history.steps.slice(0, 1), index: 0 }
  }
}

export function imagePoint(
  point: Point,
  display: { width: number; height: number },
  crop: Bounds,
): Point {
  return {
    x: crop.x + Math.max(0, Math.min(1, point.x / display.width)) * crop.width,
    y: crop.y + Math.max(0, Math.min(1, point.y / display.height)) * crop.height,
  }
}

export function cropBounds(start: Point, end: Point): Bounds {
  const x = Math.round(Math.min(start.x, end.x)),
    y = Math.round(Math.min(start.y, end.y))
  return {
    x,
    y,
    width: Math.round(Math.max(start.x, end.x)) - x,
    height: Math.round(Math.max(start.y, end.y)) - y,
  }
}

export function markPath(mark: Mark): string {
  const start = mark.points[0]
  if (!start) return ''
  const end = mark.points[mark.points.length - 1] ?? start
  if (mark.tool === 'rectangle') {
    const box = cropBounds(start, end)
    return `M ${box.x} ${box.y} h ${box.width} v ${box.height} h ${-box.width} Z`
  }
  if (mark.tool === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x)
    const head = Math.min(Math.hypot(end.x - start.x, end.y - start.y) / 2, mark.width * 4)
    return `M ${start.x} ${start.y} L ${end.x} ${end.y} M ${end.x - head * Math.cos(angle - Math.PI / 6)} ${end.y - head * Math.sin(angle - Math.PI / 6)} L ${end.x} ${end.y} L ${end.x - head * Math.cos(angle + Math.PI / 6)} ${end.y - head * Math.sin(angle + Math.PI / 6)}`
  }
  // A tiny segment renders taps as round dots as well as continuous strokes.
  if (mark.points.length === 1) return `M ${start.x} ${start.y} l 0.01 0`
  return mark.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
}
