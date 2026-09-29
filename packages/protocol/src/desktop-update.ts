export type DesktopUpdateState = {
  status: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  notes?: string
  progress?: number
}

export type DesktopUpdateBridge = {
  state: () => Promise<DesktopUpdateState>
  install: () => Promise<void>
  subscribe: (listener: (state: DesktopUpdateState) => void) => () => void
}
