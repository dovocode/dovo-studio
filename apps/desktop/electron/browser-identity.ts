import { BrowserWindow } from 'electron'

export type WebAuthOptions = {
  url: string
  interactive?: boolean
  abortOnLoadForNonInteractive?: boolean
  timeoutMsForNonInteractive?: number
}
export function extensionRedirectURL(id: string, path = '') {
  if (!/^[a-p]{32}$/.test(id)) throw new Error('Invalid extension ID.')
  const base = new URL(`https://${id}.chromiumapp.org/`)
  // Treat the supplied value as a path, never as another URL or authority.
  base.pathname = '/' + path.replace(/^\/+/, '')
  return base.href
}
export function isExtensionAuthRedirect(id: string, raw: string) {
  try {
    const url = new URL(raw)
    return url.origin === `https://${id}.chromiumapp.org` && !url.username && !url.password
  } catch {
    return false
  }
}

/** Generic redirect OAuth only. No Google token service or browser-account identity. */
export function createBrowserIdentity(session: Electron.Session) {
  const pending = new Map<BrowserWindow, { id: string; cancel: () => void }>()
  return {
    launch(id: string, options: WebAuthOptions) {
      const url = new URL(options.url)
      if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
        throw new Error('Authentication requires HTTPS or a loopback URL.')
      if (url.username || url.password) throw new Error('Invalid authentication URL.')
      if (isExtensionAuthRedirect(id, url.href)) return Promise.resolve(url.href)
      return new Promise<string>((resolve, reject) => {
        const window = new BrowserWindow({
          title: 'Extension sign-in',
          width: 620,
          height: 760,
          minWidth: 400,
          minHeight: 400,
          show: false,
          autoHideMenuBar: true,
          webPreferences: {
            session,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        })
        let finished = false
        const finish = (result?: string, reason = 'The authentication flow was cancelled.') => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          pending.delete(window)
          if (!window.isDestroyed()) window.destroy()
          if (result) resolve(result)
          else reject(new Error(reason))
        }
        const timer = setTimeout(
          () => finish(undefined, 'The authentication flow timed out.'),
          options.interactive ? 10 * 60_000 : (options.timeoutMsForNonInteractive ?? 60_000),
        )
        pending.set(window, { id, cancel: () => finish() })
        const intercept = (
          event: Electron.Event<
            | Electron.WebContentsWillNavigateEventParams
            | Electron.WebContentsWillRedirectEventParams
          >,
        ) => {
          if (!event.isMainFrame) return
          const target = event.url
          if (isExtensionAuthRedirect(id, target)) {
            event.preventDefault()
            finish(target)
            return
          }
          try {
            const parsed = new URL(target)
            if (!['https:', 'http:'].includes(parsed.protocol)) {
              event.preventDefault()
              finish(undefined, 'Unsupported authentication navigation.')
            }
          } catch {
            event.preventDefault()
            finish(undefined, 'Invalid authentication navigation.')
          }
        }
        window.webContents.on('will-redirect', intercept)
        window.webContents.on('will-navigate', intercept)
        window.webContents.setWindowOpenHandler(({ url: target }) => {
          if (isExtensionAuthRedirect(id, target)) finish(target)
          else if (/^https?:/.test(target))
            void window.loadURL(target).catch(() => {
              if (!finished) finish(undefined, 'Authentication page could not be loaded.')
            })
          return { action: 'deny' }
        })
        window.webContents.on('did-finish-load', () => {
          if (finished) return
          if (options.interactive) window.show()
          else if (options.abortOnLoadForNonInteractive !== false)
            finish(undefined, 'The authentication flow requires interaction.')
        })
        window.once('closed', () => finish())
        void window.loadURL(url.href).catch(() => {
          if (!finished) finish(undefined, 'Authentication page could not be loaded.')
        })
      })
    },
    close(id: string) {
      for (const entry of [...pending.values()]) if (entry.id === id) entry.cancel()
    },
    dispose() {
      for (const entry of [...pending.values()]) entry.cancel()
    },
  }
}
