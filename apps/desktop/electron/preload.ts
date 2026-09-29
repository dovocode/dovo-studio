import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dovo', {
  platform:
    process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
  browser: (
    command: import('@dovo/protocol').BrowserCommand,
  ): ReturnType<import('@dovo/protocol').BrowserBridge> =>
    ipcRenderer.invoke('preview:browser', command),
  updates: {
    state: (): Promise<import('@dovo/protocol').DesktopUpdateState> =>
      ipcRenderer.invoke('updates:state'),
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
  runtimeNetwork: (address: string, enabled?: boolean): Promise<unknown> =>
    ipcRenderer.invoke('runtime:network', address, enabled),
  readRuntimeRegistry: (): Promise<string | null> => ipcRenderer.invoke('runtime:registry-read'),
  writeRuntimeRegistry: (value: string): Promise<void> =>
    ipcRenderer.invoke('runtime:registry-write', value),
  extensions: () => ipcRenderer.invoke('runtime:list-extensions'),
  activateExtension: (id: string) => ipcRenderer.invoke('runtime:activate', id),
})
