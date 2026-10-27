import { BrowserWindow } from 'electron'

type FloatingTab = {
  window: BrowserWindow
  view: Electron.WebContentsView
  onReturn: () => void
}
const RETURN_URL = 'dovo-pip://return'
const chrome = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
html{color-scheme:light dark}body{margin:0;font:13px system-ui;background:light-dark(#fafafa,#202020)}a{display:block;height:36px;box-sizing:border-box;padding:8px 12px;color:inherit;text-decoration:none}a:hover,a:focus{background:light-dark(#eee,#333)}
</style><a href="${RETURN_URL}">↗ Return to browser</a>`

/** Reparent the live view; no second session, navigation or capture of the call page. */
export function createBrowserPictureInPicture() {
  const floating = new Map<number, { window: BrowserWindow; restore: (focus: boolean) => void }>()
  return {
    has: (contents: Electron.WebContents) => floating.has(contents.id),
    async open(tab: FloatingTab) {
      const contents = tab.view.webContents
      const existing = floating.get(contents.id)
      if (existing) {
        if (existing.window.isMinimized()) existing.window.restore()
        existing.window.show()
        existing.window.focus()
        return
      }
      const bounds = tab.view.getBounds()
      const visible = tab.view.getVisible()
      let attached = false
      const window = new BrowserWindow({
        width: 640,
        height: 440,
        minWidth: 320,
        minHeight: 240,
        title: 'Dovo Picture-in-Picture',
        alwaysOnTop: true,
        show: false,
        autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      window.setMenu(null)
      // Detach before destroying the window: Electron otherwise destroys the live call too.
      const restore = (focus: boolean) => {
        if (floating.get(contents.id)?.window !== window) return
        floating.delete(contents.id)
        if (attached) window.contentView.removeChildView(tab.view)
        if (attached && !contents.isDestroyed() && !tab.window.isDestroyed()) {
          tab.window.contentView.addChildView(tab.view)
          tab.view.setBounds(bounds)
          tab.view.setVisible(visible)
        }
        if (!window.isDestroyed()) window.destroy()
        if (focus && !contents.isDestroyed() && !tab.window.isDestroyed()) tab.onReturn()
      }
      floating.set(contents.id, { window, restore })
      window.on('close', (event) => {
        event.preventDefault()
        restore(true)
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, url) => {
        event.preventDefault()
        if (url === RETURN_URL) restore(true)
      })
      const resize = () => {
        const [width, height] = window.getContentSize()
        tab.view.setBounds({ x: 0, y: 36, width, height: Math.max(1, height - 36) })
      }
      window.on('resize', resize)
      try {
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(chrome)}`)
        if (floating.get(contents.id)?.window !== window || contents.isDestroyed()) return
        tab.window.contentView.removeChildView(tab.view)
        window.contentView.addChildView(tab.view)
        attached = true
        contents.disableDeviceEmulation()
        resize()
        tab.view.setVisible(true)
        window.show()
        window.focus()
        contents.focus()
      } catch (cause) {
        restore(false)
        throw cause
      }
    },
    restore: (contents: Electron.WebContents, focus: boolean) =>
      floating.get(contents.id)?.restore(focus),
    dispose: () => {
      for (const item of floating.values()) item.restore(false)
    },
  }
}

/** Return video PiP to its original frame without starting another video. */
export async function exitBrowserVideoPictureInPicture(contents: Electron.WebContents) {
  for (const frame of contents.mainFrame.framesInSubtree) {
    const active: unknown = await frame.executeJavaScript(
      'Boolean(document.pictureInPictureElement)',
    )
    if (active === true) {
      await frame.executeJavaScript('document.exitPictureInPicture()', true)
      return true
    }
  }
  return false
}

/** Standard video PiP, including videos hosted in embedded frames. */
export async function toggleBrowserVideoPictureInPicture(contents: Electron.WebContents) {
  // Exit an existing iframe PiP before considering a video in the top-level page.
  if (await exitBrowserVideoPictureInPicture(contents)) return
  for (const frame of contents.mainFrame.framesInSubtree) {
    const result: unknown = await frame.executeJavaScript(
      `(async () => {
      if (!document.pictureInPictureEnabled) return false;
      const videos = [...document.querySelectorAll('video')]
        .filter(video => video.readyState > 0 && video.videoWidth > 0 && !video.disablePictureInPicture)
        .sort((a,b) => Number(a.paused)-Number(b.paused) || b.videoWidth*b.videoHeight-a.videoWidth*a.videoHeight);
      if (!videos.length) return false;
      await videos[0].requestPictureInPicture(); return true;
    })()`,
      true,
    )
    if (result === true) return
  }
  throw new Error('No video is ready for Picture-in-Picture on this page. Start a video first.')
}
