import { app, BrowserWindow, WebContentsView } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

export const DOCUMENT_PIP_HEADER_HEIGHT = 36

const PRELOAD = `
const { ipcRenderer } = require('electron')
window.addEventListener('DOMContentLoaded', () => {
  for (const button of document.querySelectorAll('button[data-action]'))
    button.addEventListener('click', event => {
      if (event.isTrusted) ipcRenderer.send('browser:document-pip-control', button.dataset.action)
    })
}, { once: true })
`

/** Native sibling views keep even fixed-position website content below trusted window chrome. */
export function createDocumentPipWindow(
  options: Electron.BrowserWindowConstructorOptions & { webContents?: Electron.WebContents },
  sourceURL: string,
  returnToTab?: () => void | Promise<void>,
) {
  const hostname = new URL(sourceURL).hostname
  const directory = join(app.getPath('userData'), 'browser-media')
  mkdirSync(directory, { recursive: true })
  const preload = join(directory, 'pip-controls.preload.cjs')
  writeFileSync(preload, PRELOAD)
  // Electron's createWindow supplies the pending guest, which owns the real opener/DOM.
  // It must be adopted exactly once; the trusted header needs its own WebContents.
  const { webContents: guest, ...chromeOptions } = options
  if (!guest) throw new Error('Document PiP requires the pending popup WebContents.')
  const page = new WebContentsView({ webContents: guest, webPreferences: options.webPreferences })
  const popup = new BrowserWindow({
    ...chromeOptions,
    webPreferences: {
      preload,
      partition: 'dovo-document-pip-chrome',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  })
  popup.contentView.addChildView(page)
  const layout = () => {
    const [width, height] = popup.getContentSize()
    page.setBounds({
      x: 0,
      y: DOCUMENT_PIP_HEADER_HEIGHT,
      width,
      height: Math.max(0, height - DOCUMENT_PIP_HEADER_HEIGHT),
    })
  }
  layout()
  popup.on('resize', layout)
  const contents = popup.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event) => event.preventDefault())
  let returning = false
  contents.ipc.on('browser:document-pip-control', (event, action: unknown) => {
    if (event.senderFrame !== contents.mainFrame || popup.isDestroyed()) return
    if (action === 'close') {
      popup.close()
      return
    }
    if (action !== 'return' || !returnToTab || returning) return
    returning = true
    void Promise.resolve()
      .then(returnToTab)
      .then(() => {
        if (!popup.isDestroyed()) popup.close()
      })
      .catch((error) => console.error('Could not return the call to its tab.', error))
      .finally(() => {
        returning = false
      })
  })
  popup.once('closed', () => {
    popup.removeListener('resize', layout)
    if (!guest.isDestroyed()) guest.close()
  })
  // Electron's CloseContents emits this before native view teardown, but its generated
  // WebContents overloads omit it. Use the inherited Node event API for that event.
  EventEmitter.prototype.once.call(guest, 'close', () => {
    popup.removeListener('resize', layout)
    if (!popup.isDestroyed()) popup.contentView.removeChildView(page)
  })
  guest.once('destroyed', () => {
    popup.removeListener('resize', layout)
    // The guest can close itself. Do not tear down its containing native view tree
    // reentrantly while Chromium is still destroying that same guest view.
    setImmediate(() => {
      if (!popup.isDestroyed()) popup.destroy()
    })
  })
  const button = (label: string, action: string, paths: string[]) =>
    `<button type="button" title="${label}" aria-label="${label}" data-action="${action}"><svg viewBox="0 0 24 24" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg></button>`
  const escapedHostname = hostname.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Picture-in-picture controls</title><style>
* {box-sizing:border-box} body {margin:0;background:#202124;color:#e8eaed;font:12px system-ui}
.bar {display:flex;height:${DOCUMENT_PIP_HEADER_HEIGHT}px;align-items:center;padding:0 4px 0 12px;gap:2px;-webkit-app-region:drag}
.domain {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button {display:grid;place-items:center;flex:none;width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;-webkit-app-region:no-drag}
button:hover {background:#ffffff25} button:focus-visible {outline:2px solid white;outline-offset:-2px}
svg {width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
</style></head><body><div class="bar" role="toolbar" aria-label="Picture-in-picture controls">
<span class="domain" title="${escapedHostname}">${escapedHostname}</span>
${returnToTab ? button('Back to tab', 'return', ['M14 4h6v16H4v-6', 'M4 4h7v7', 'M11 4 3 12']) : ''}
${button('Close picture-in-picture', 'close', ['m6 6 12 12', 'M18 6 6 18'])}
</div></body></html>`
  void contents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .catch((error) => {
      if (!contents.isDestroyed())
        console.error('Could not load picture-in-picture controls.', error)
    })
  return { window: popup, contents: guest }
}
