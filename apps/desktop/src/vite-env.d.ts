/// <reference types="vite/client" />

interface Window {
  dovo: {
    taskLauncher: import('@dovo/protocol').TaskLauncherBridge
    inputPreview: import('@dovo/protocol').InputPreviewBridge
    appInfo: NonNullable<import('@dovo/studio-core').StudioHostApi['appInfo']>
    platform: 'darwin' | 'win32' | 'linux'
    windowsRuntime?: import('@dovo/protocol').WindowsRuntimeBridge
    chooseLink: NonNullable<import('@dovo/studio-core').StudioHostApi['chooseLink']>
    openExternalLink: NonNullable<import('@dovo/studio-core').StudioHostApi['openExternalLink']>
    browser: import('@dovo/protocol').BrowserBridge
    updates: import('@dovo/protocol').DesktopUpdateBridge
    pickDirectory(this: void, runtimeAddress: string): Promise<string | null>
    extensions(): Promise<import('@dovo/client-runtime').ExtensionInfo[]>
    activateExtension(id: string): Promise<import('@dovo/client-runtime').ExtensionInfo>
  }
}
