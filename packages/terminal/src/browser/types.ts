import type { TerminalRendererKind, TerminalRenderOptions } from './render-types'

export type TerminalTheme = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  selectionForeground?: string
} & Partial<
  Record<
    | 'black'
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white'
    | 'brightBlack'
    | 'brightRed'
    | 'brightGreen'
    | 'brightYellow'
    | 'brightBlue'
    | 'brightMagenta'
    | 'brightCyan'
    | 'brightWhite',
    string
  >
>

export type TerminalFontSource = { family: string; url: string; weight: string }
export type BrowserTerminalOptions = {
  fontFamily: string
  fontSize: number
  theme: TerminalTheme
  /** Bounded Ghostty history allocation in bytes (default 16 MiB). */
  scrollbackBytes?: number
  fonts?: TerminalFontSource[]
  renderer?: TerminalRendererKind
}
export type TerminalPoint = { x: number; y: number }
export type TerminalViewportLine = { text: string; widths: number[]; wrapped: boolean }
export type TerminalViewport = {
  cols: number
  rows: number
  top: number
  history: number
  lines: TerminalViewportLine[]
  metrics: Pick<TerminalRenderOptions, 'cellWidth' | 'cellHeight'>
  cursor: TerminalPoint
  mouseTracking: boolean
}
export type TerminalWorkerRequest =
  | {
      type: 'init'
      canvas?: OffscreenCanvas
      options: BrowserTerminalOptions
      devicePixelRatio: number
    }
  | { type: 'canvas'; canvas?: OffscreenCanvas; renderer: TerminalRendererKind }
  | { type: 'configure'; options: BrowserTerminalOptions; devicePixelRatio: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'visible'; visible: boolean }
  | { type: 'inputEnabled'; enabled: boolean }
  | { type: 'connect'; id: number; url: string; port?: MessagePort }
  | { type: 'disconnect'; id: number }
  | { type: 'input'; text: string; paste?: boolean }
  | {
      type: 'key'
      code: string
      key: string
      ctrl: boolean
      alt: boolean
      shift: boolean
      meta: boolean
      repeat: boolean
    }
  | { type: 'focus'; focused: boolean }
  | {
      type: 'pointer'
      phase: 'down' | 'move' | 'up'
      point: TerminalPoint
      button: number
      shift: boolean
      alt: boolean
      ctrl: boolean
    }
  | {
      type: 'scroll'
      lines: number
      point?: TerminalPoint
      shift?: boolean
      alt?: boolean
      ctrl?: boolean
    }
  | { type: 'selectWord'; point: TerminalPoint }
  | { type: 'selectAll' }
  | { type: 'clearSelection' }
  | { type: 'readSelection' }
  | { type: 'dispose' }

export type TerminalWorkerEvent =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'connection'; id: number; state: 'open' | 'close' | 'error'; message?: string }
  | { type: 'viewport'; viewport: TerminalViewport }
  | { type: 'selection'; text: string }
  | { type: 'renderer'; renderer: TerminalRendererKind }
  | { type: 'replaceCanvas'; renderer: TerminalRendererKind }
  | { type: 'bitmap'; bitmap: ImageBitmap }

/** Only transport controls cross Electron IPC; terminal bytes are binary messages. */
export type TerminalPortEvent =
  | { type: 'open' }
  | { type: 'data'; data: ArrayBuffer | string }
  | { type: 'error'; message: string }
  | { type: 'close'; message: string }
