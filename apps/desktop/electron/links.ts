import { BrowserWindow, dialog, shell, type WebContents } from 'electron'
import { previewUrl } from '@dovo/protocol'

const receivers = new WeakSet<WebContents>()
const observed = new WeakSet<WebContents>()
const fallbackPending = new WeakSet<BrowserWindow>()

/** Only trusted app renderers may register, through the validated main-process IPC handler. */
export function setLinkReceiver(contents: WebContents, ready: boolean) {
  if (ready) receivers.add(contents)
  else receivers.delete(contents)
  if (observed.has(contents)) return
  observed.add(contents)
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) receivers.delete(contents)
  })
  contents.on('render-process-gone', () => receivers.delete(contents))
}

export async function openExternalLink(raw: string) {
  await shell.openExternal(previewUrl(raw))
}

export async function offerLink(
  parent: BrowserWindow,
  raw: string,
  onInternal?: (url: string) => void,
) {
  let url: string
  try {
    url = previewUrl(raw)
  } catch {
    return false
  }
  if (receivers.has(parent.webContents)) {
    parent.webContents.send('links:open', url)
    parent.show()
    parent.focus()
    return false
  }
  if (fallbackPending.has(parent)) return false
  fallbackPending.add(parent)
  try {
    const answer = await dialog.showMessageBox(parent, {
      type: 'question',
      message: 'Open this link?',
      detail: url,
      buttons: ['Open in Dovo', 'Open in default browser', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    })
    if (answer.response === 1) {
      await shell.openExternal(url)
      return false
    }
    if (answer.response !== 0) return false
    if (onInternal) {
      onInternal(url)
      return true
    }
    await openBrowserLink(parent, url)
    return false
  } finally {
    fallbackPending.delete(parent)
  }
}

export async function openBrowserLink(parent: BrowserWindow, raw: string) {
  const url = previewUrl(raw)
  const browser = new BrowserWindow({
    parent,
    width: 1100,
    height: 800,
    title: 'Dovo Browser',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'dovo-links',
    },
  })
  browser.webContents.setWindowOpenHandler(({ url: next }) => {
    void offerLink(parent, next)
    return { action: 'deny' }
  })
  browser.webContents.on('will-navigate', (event, next) => {
    try {
      previewUrl(next)
    } catch {
      event.preventDefault()
    }
  })
  browser.webContents.session.setPermissionRequestHandler((_contents, _permission, respond) =>
    respond(false),
  )
  browser.webContents.session.setPermissionCheckHandler(() => false)
  await browser.loadURL(url)
}
