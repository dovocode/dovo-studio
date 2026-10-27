/// <reference types="vite/client" />

interface Window {
  dovo: {
    accountStorage: import('@dovo/protocol').AccountStorage
    runtimeSync: import('@dovo/protocol').DesktopRuntimeSyncBridge
    popOutThread: import('@dovo/protocol').ThreadWindowBridge
    taskLauncher: import('@dovo/protocol').TaskLauncherBridge
    inputPreview: import('@dovo/protocol').InputPreviewBridge
    appInfo: NonNullable<import('@dovo/studio-core').StudioHostApi['appInfo']>
    platform: 'darwin' | 'win32' | 'linux'
    windowsRuntime?: import('@dovo/protocol').WindowsRuntimeBridge
    onOpenLink: (listener: (url: string) => void) => () => void
    openBrowserLink: NonNullable<import('@dovo/studio-core').StudioHostApi['openBrowserLink']>
    openExternalLink: NonNullable<import('@dovo/studio-core').StudioHostApi['openExternalLink']>
    openBrowserWindow: () => Promise<void>
    onBrowserWorkspaceFocus: (listener: () => void) => () => void
    browser: import('@dovo/protocol').BrowserBridge
    onBrowserContextAction: NonNullable<
      import('@dovo/studio-core').StudioHostApi['onBrowserContextAction']
    >
    browserExtensions: import('@dovo/protocol').BrowserExtensionBridge
    updates: import('@dovo/protocol').DesktopUpdateBridge
    repositoryOpener: import('@dovo/protocol').RepositoryOpenerBridge
    pickDirectory(this: void, runtimeAddress: string): Promise<string | null>
    extensions(): Promise<import('@dovo/client-runtime').ExtensionInfo[]>
    activateExtension(id: string): Promise<import('@dovo/client-runtime').ExtensionInfo>
    setWindowColors(this: void, colors: { background: string; symbol: string }): Promise<void>
  }
}
