/// <reference types="vite/client" />

interface Window {
  dovo: {
    platform: 'darwin' | 'win32' | 'linux'
    browser: import('@dovo/protocol').BrowserBridge
    pickDirectory(this: void, runtimeAddress: string): Promise<string | null>
    extensions(): Promise<import('@dovo/client-runtime').ExtensionInfo[]>
    activateExtension(id: string): Promise<import('@dovo/client-runtime').ExtensionInfo>
  }
}
