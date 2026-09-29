export type DesktopUpdateState = {
  status: 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'
  version?: string
  notes?: string
  progress?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}

export type DesktopUpdateBridge = {
  state: () => Promise<DesktopUpdateState>
  check: () => Promise<void>
  install: () => Promise<void>
  subscribe: (listener: (state: DesktopUpdateState) => void) => () => void
}
