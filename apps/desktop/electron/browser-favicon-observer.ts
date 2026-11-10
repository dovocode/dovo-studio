import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserFaviconUpdateSchema, decodeResult } from '@dovo/protocol'

/** Use the same DOM discovery as remote pages, inside Electron's isolated preload world. */
export function createNativeFaviconObserver(
  observe: typeof import('@dovo/runtime/browser-favicon').observeBrowserFavicons,
) {
  const sessions = new Map<Electron.Session, string>()
  const preload = `if (process.isMainFrame) {
    const { ipcRenderer } = require('electron')
    const observe = ${observe.toString()}
    observe(update => ipcRenderer.send('browser:favicon', update))
  }`
  return {
    attach(
      contents: Electron.WebContents,
      update: (url: string, icons: readonly string[]) => void,
    ) {
      const session = contents.session
      if (!sessions.has(session)) {
        const directory = join(app.getPath('userData'), 'browser-favicon')
        mkdirSync(directory, { recursive: true })
        const filePath = join(directory, 'preload.js')
        writeFileSync(filePath, preload)
        sessions.set(
          session,
          session.registerPreloadScript({ id: 'dovo-browser-favicon', type: 'frame', filePath }),
        )
      }
      contents.ipc.on('browser:favicon', (event, value: unknown) => {
        if (contents.isDestroyed() || event.senderFrame !== contents.mainFrame) return
        const parsed = decodeResult(browserFaviconUpdateSchema, value)
        if (parsed.success && parsed.data.url === contents.getURL())
          update(parsed.data.url, parsed.data.icons)
      })
    },
    dispose() {
      for (const [session, id] of sessions) session.unregisterPreloadScript(id)
      sessions.clear()
    },
  }
}
