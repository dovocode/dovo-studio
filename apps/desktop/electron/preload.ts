import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dovo', {
  platform:
    process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
  browser: (
    command: import('@dovo/protocol').BrowserCommand,
  ): ReturnType<import('@dovo/protocol').BrowserBridge> =>
    ipcRenderer.invoke('preview:browser', command),
  pickDirectory: (runtimeAddress: string): Promise<string | null> =>
    ipcRenderer.invoke('repositories:pick-directory', runtimeAddress),
  runtimeConnection: () => ipcRenderer.invoke('runtime:connection'),
  readRuntimeRegistry: (): Promise<string | null> => ipcRenderer.invoke('runtime:registry-read'),
  writeRuntimeRegistry: (value: string): Promise<void> =>
    ipcRenderer.invoke('runtime:registry-write', value),
  extensions: () => ipcRenderer.invoke('runtime:list-extensions'),
  activateExtension: (id: string) => ipcRenderer.invoke('runtime:activate', id),
})
