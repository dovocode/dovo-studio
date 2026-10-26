import { BrowserWindow } from 'electron'
import { createRuntimeClient, remoteBrowserTicketSchema, type BrowserCommand } from '@dovo/protocol'
import { remoteBrowserHtml } from '@dovo/protocol/browser-viewer'

type Source = Extract<BrowserCommand, { action: 'remote-media-sources' }>['sources'][number]

/** A dedicated, noninteractive viewer captures only the remote tab, never Studio's chrome. */
export async function openRemoteMedia(source: Source) {
  const client = createRuntimeClient(source.connection)
  const ticket = await client.request(
    '/api/previews/browser/open',
    { taskId: 'studio:browser', tabId: source.tabId, profileId: source.profileId },
    remoteBrowserTicketSchema,
  )
  if (ticket.tabId !== source.tabId || ticket.profileId !== source.profileId)
    throw new Error('Update the remote runtime to share its browser tabs.')
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  const contents = window.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(remoteBrowserHtml)}`)
    await contents.insertCSS(
      'body > :not(#viewport) { display: none !important } #viewport > :not(canvas):not(#empty) { display: none !important } #viewport { background: white; pointer-events: none }',
    )
    await contents.executeJavaScript(`new Promise((resolve, reject) => {
      const canvas = document.getElementById('page')
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('The remote tab did not send a video frame.')) }, 15000)
      const observer = new MutationObserver(() => {
        if (!canvas.hidden && canvas.width > 0) { clearTimeout(timer); observer.disconnect(); resolve(true) }
      })
      observer.observe(canvas, { attributes: true })
      window.postMessage({channel:'dovo-browser', type:'presentation', expanded:true, externalNavigation:true}, '*')
      window.postMessage({channel:'dovo-browser', type:'connect', url:${JSON.stringify(client.socketUrl('/ws/browser', ticket))}}, '*')
    })`)
    return {
      contents,
      close: () => {
        if (!window.isDestroyed()) window.destroy()
      },
    }
  } catch (error) {
    window.destroy()
    throw error
  }
}
