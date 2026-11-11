import { studioContents } from './studio-window.js'
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
  if (receivers.has(studioContents(parent))) {
    studioContents(parent).send('links:open', url)
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
  const trackPreview = (preview: BrowserWindow) => {
    preview.webContents.setWindowOpenHandler(({ url: next }) => {
      try {
        if (next && next !== 'about:blank') previewUrl(next)
      } catch {
        return { action: 'deny' }
      }
      // The user already chose this browser. Let Chromium retain the opener,
      // session and POST body instead of sending each new page to Studio's chooser.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: preview,
          autoHideMenuBar: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            webviewTag: false,
          },
        },
      }
    })
    const guard = (event: Electron.Event, next: string) => {
      try {
        if (next !== 'about:blank') previewUrl(next)
      } catch {
        event.preventDefault()
      }
    }
    preview.webContents.on('will-navigate', guard)
    preview.webContents.on('will-redirect', guard)
    preview.webContents.on('did-create-window', trackPreview)
  }
  trackPreview(browser)
  browser.webContents.session.setPermissionRequestHandler((_contents, _permission, respond) =>
    respond(false),
  )
  browser.webContents.session.setPermissionCheckHandler(() => false)
  await browser.loadURL(url)
}

const externalLinks: string[] = []
const delivering = new WeakSet<BrowserWindow>()
/** Accept OS launches and the explicit dovo-studio://open?url=... handoff. */
export function queueExternalLinks(inputs: readonly string[]) {
  for (const input of inputs) {
    if (externalLinks.length >= 20 || input.length > 8192) continue
    try {
      const link = new URL(input)
      const raw =
        link.protocol === 'dovo-studio:' && link.hostname === 'open'
          ? link.searchParams.get('url')
          : /^https?:$/.test(link.protocol)
            ? input
            : undefined
      if (raw) externalLinks.push(previewUrl(raw))
    } catch {
      /* Arguments other than supported links are not URLs to open. */
    }
  }
}
/** Cold-start links wait for the trusted renderer, including across renderer reloads. */
export async function flushExternalLinks(
  parent: BrowserWindow,
  route?: (url: string) => Promise<boolean>,
) {
  if (delivering.has(parent)) return
  delivering.add(parent)
  try {
    while (externalLinks.length && !parent.isDestroyed() && receivers.has(studioContents(parent))) {
      const url = externalLinks[0]!
      let routed = false
      try {
        routed = (await route?.(url)) ?? false
      } catch (cause) {
        // Keep a failed route actionable in the normal chooser and allow the
        // remaining OS links to drain instead of retrying the same head forever.
        console.error('Could not route external browser link', cause)
      }
      if (parent.isDestroyed()) break
      if (!routed) await offerLink(parent, url)
      externalLinks.shift()
    }
  } finally {
    delivering.delete(parent)
  }
}
