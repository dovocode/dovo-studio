import { BrowserWindow, dialog, shell } from 'electron'
import { previewUrl } from '@dovo/protocol'

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
    void offerLink(browser, next)
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
  return false
}
