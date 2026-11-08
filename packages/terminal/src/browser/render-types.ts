export type TerminalRendererKind = 'webgpu' | 'webgl2' | 'canvas2d'

export type TerminalRenderCell = {
  text: string
  width: number
  foreground: string
  background: string
  flags: number
}

export type TerminalRenderFrame = {
  cols: number
  rows: number
  cells: TerminalRenderCell[][]
  cursor: { x: number; y: number; visible: boolean; style: 'block' | 'underline' | 'bar' }
}

export type TerminalRenderOptions = {
  fontFamily: string
  fontSize: number
  cellWidth: number
  cellHeight: number
  baseline: number
  devicePixelRatio: number
  background: string
  cursor: string
}

export interface TerminalRenderer {
  readonly kind: TerminalRendererKind
  resize(width: number, height: number): void
  render(frame: TerminalRenderFrame, options: TerminalRenderOptions): void
  dispose(): void
}
