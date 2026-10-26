import { BrowserWindow } from 'electron'
import type { ThreadWindowTarget } from '@dovo/protocol'

export async function openThreadMedia(
  target: ThreadWindowTarget,
  rendererPath: string,
  preload: string,
) {
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // A hidden static conversation may never repaint after capture starts.
      // Offscreen rendering gives Chromium a live surface even before new messages arrive.
      offscreen: true,
      preload,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  // Offscreen surfaces need a paint subscriber to deliver frames to capture.
  // getDisplayMedia consumes them natively; no bitmap processing is needed here.
  window.webContents.on('paint', () => {})
  window.webContents.startPainting()
  try {
    const hash = 'thread-share=' + encodeURIComponent(JSON.stringify(target))
    if (process.env.VITE_DEV_SERVER_URL) {
      const url = new URL(process.env.VITE_DEV_SERVER_URL)
      url.hash = hash
      await window.loadURL(url.href)
    } else await window.loadFile(rendererPath, { hash })
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const ready = () => document.querySelector('[data-thread-share-ready]')
      if (ready()) return resolve(true)
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('The thread could not be loaded for sharing.')) }, 15000)
      const observer = new MutationObserver(() => { if (ready()) { clearTimeout(timer); observer.disconnect(); resolve(true) } })
      observer.observe(document.body, { subtree: true, childList: true, attributes: true })
    })`)
    return {
      contents: window.webContents,
      close: () => {
        if (!window.isDestroyed()) window.destroy()
      },
    }
  } catch (error) {
    window.destroy()
    throw error
  }
}
