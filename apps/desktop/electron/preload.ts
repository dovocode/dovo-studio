import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dovo', {
  taskLauncher: {
    sync: (registry: import('@dovo/protocol').RuntimeRegistry) =>
      ipcRenderer.invoke('task-launcher:sync', registry),
    current: () => ipcRenderer.invoke('task-launcher:current'),
    open: () => ipcRenderer.invoke('task-launcher:open'),
    dismiss: () => ipcRenderer.invoke('task-launcher:dismiss'),
    configure: (shortcut: import('@dovo/protocol').TaskLauncherShortcut) =>
      ipcRenderer.invoke('task-launcher:configure', shortcut),
    subscribe: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('task-launcher:open', handler)
      void ipcRenderer
        .invoke('task-launcher:ready')
        .catch((error: unknown) => console.error('Could not initialize the task launcher:', error))
      return () => ipcRenderer.removeListener('task-launcher:open', handler)
    },
  },
  inputPreview: {
    sync: (value: Parameters<import('@dovo/protocol').InputPreviewBridge['sync']>[0]) =>
      ipcRenderer.invoke('input-preview:sync', value),
    current: () => ipcRenderer.invoke('input-preview:current'),
    answer: (value: import('@dovo/protocol').InputPreviewAnswer) =>
      ipcRenderer.invoke('input-preview:answer', value),
    dismiss: () => ipcRenderer.invoke('input-preview:dismiss'),
    openThread: () => ipcRenderer.invoke('input-preview:open'),
    subscribe: (listener: (value: import('@dovo/protocol').InputPreview | null) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: import('@dovo/protocol').InputPreview | null,
      ) => listener(value)
      ipcRenderer.on('input-preview:state', handler)
      return () => ipcRenderer.removeListener('input-preview:state', handler)
    },
    onOpenThread: (listener: (value: { runtimeId: string; entityId: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: { runtimeId: string; entityId: string },
      ) => listener(value)
      ipcRenderer.on('input-preview:open-thread', handler)
      return () => ipcRenderer.removeListener('input-preview:open-thread', handler)
    },
  },
  chooseLink: (url: string): Promise<boolean> => ipcRenderer.invoke('links:choose', url),
  openExternalLink: (url: string): Promise<void> => ipcRenderer.invoke('links:external', url),
  appInfo: ipcRenderer.sendSync('app:info'),
  platform:
    process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
  browser: (
    command: import('@dovo/protocol').BrowserCommand,
  ): ReturnType<import('@dovo/protocol').BrowserBridge> =>
    ipcRenderer.invoke('preview:browser', command),
  updates: {
    state: (): Promise<import('@dovo/protocol').DesktopUpdateState> =>
      ipcRenderer.invoke('updates:state'),
    check: (): Promise<void> => ipcRenderer.invoke('updates:check'),
    setChannel: (channel: import('@dovo/protocol').DesktopUpdateChannel): Promise<void> =>
      ipcRenderer.invoke('updates:channel', channel),
    install: (): Promise<void> => ipcRenderer.invoke('updates:install'),
    subscribe: (listener: (state: import('@dovo/protocol').DesktopUpdateState) => void) => {
      const onState = (
        _event: Electron.IpcRendererEvent,
        state: import('@dovo/protocol').DesktopUpdateState,
      ) => listener(state)
      ipcRenderer.on('updates:state', onState)
      return () => ipcRenderer.removeListener('updates:state', onState)
    },
  },
  pickDirectory: (runtimeAddress: string): Promise<string | null> =>
    ipcRenderer.invoke('repositories:pick-directory', runtimeAddress),
  runtimeConnection: () => ipcRenderer.invoke('runtime:connection'),
  windowsRuntime:
    process.platform === 'win32'
      ? {
          read: (): Promise<import('@dovo/protocol').WindowsRuntimeStatus> =>
            ipcRenderer.invoke('runtime:windows-read'),
          connection: (): Promise<{ address: string; token: string }> =>
            ipcRenderer.invoke('runtime:windows-connection'),
          save: (
            choice: import('@dovo/protocol').WindowsRuntimeChoice,
          ): Promise<{ address: string; token: string }> =>
            ipcRenderer.invoke('runtime:windows-save', choice),
        }
      : undefined,
  runtimeNetwork: (address: string, enabled?: boolean, port?: number): Promise<unknown> =>
    ipcRenderer.invoke('runtime:network', address, enabled, port),
  readRuntimeRegistry: (): Promise<string | null> => ipcRenderer.invoke('runtime:registry-read'),
  writeRuntimeRegistry: (value: string): Promise<void> =>
    ipcRenderer.invoke('runtime:registry-write', value),
  readAppSettings: () => {
    const result: { value?: unknown; error?: string } = ipcRenderer.sendSync('app:settings-read')
    if (result.error) throw new Error(result.error)
    return result.value ?? null
  },
  writeAppSettings: (value: string) => {
    const result: { error?: string } = ipcRenderer.sendSync('app:settings-write', value)
    if (result.error) throw new Error(result.error)
  },
  extensions: () => ipcRenderer.invoke('runtime:list-extensions'),
  activateExtension: (id: string) => ipcRenderer.invoke('runtime:activate', id),
})
