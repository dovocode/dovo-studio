import type { Session, WebContents } from 'electron'
import { isTeamsBrowserUrl } from './browser-document-pip-policy.js'

const tracking = new WeakMap<Session, boolean>()
export function configureBrowserDoNotTrack(session: Session, enabled: boolean) {
  tracking.set(session, enabled)
}

const sessions = new WeakMap<Session, Map<number, { contents: WebContents; native: string }>>()

/** Keep the real engine identity unless a site explicitly rejects Electron. */
export function browserUserAgent(nativeUserAgent: string, input: string) {
  try {
    const url = new URL(input)
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      (url.hostname === 'web.whatsapp.com' || isTeamsBrowserUrl(url))
    )
      return nativeUserAgent.replace(/\s+(?:Electron|DovoStudio|Dovo-Studio)\/[^\s]+/gi, '')
  } catch {
    // Blank and internal documents retain the native identity.
  }
  return nativeUserAgent
}

/** Per-view overrides must never change another tab's shared session identity. */
export function configureBrowserIdentity(contents: WebContents, nativeUserAgent: string) {
  const profileSession = contents.session
  let pages = sessions.get(profileSession)
  if (!pages) {
    pages = new Map()
    sessions.set(profileSession, pages)
    const registered = pages
    profileSession.webRequest.onBeforeSendHeaders((details, respond) => {
      const page =
        details.webContentsId === undefined ? undefined : registered.get(details.webContentsId)
      const live = page && !page.contents.isDestroyed()
      const doNotTrack = tracking.get(profileSession) === true
      if (!live && !doNotTrack) {
        respond({})
        return
      }
      const headers = { ...details.requestHeaders }
      if (live) {
        // History and redirect requests can capture the previous UA before navigation
        // events run. Keep their HTTP identity consistent with the destination document.
        const userAgent =
          details.resourceType === 'mainFrame'
            ? browserUserAgent(page.native, details.url)
            : page.contents.getUserAgent()
        const key = Object.keys(headers).find((key) => key.toLowerCase() === 'user-agent')
        headers[key ?? 'User-Agent'] = userAgent
      }
      // Background/service-worker requests use the same profile preference.
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'dnt') delete headers[key]
      if (doNotTrack) headers.DNT = '1'
      respond({ requestHeaders: headers })
    })
  }
  pages.set(contents.id, { contents, native: nativeUserAgent })
  const registered = pages
  contents.once('destroyed', () => registered.delete(contents.id))
  const navigate = (url: string) => contents.setUserAgent(browserUserAgent(nativeUserAgent, url))
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) navigate(details.url)
  })
  contents.on('will-redirect', (_event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) navigate(url)
  })
  // Also covers history traversal and Electron-initiated navigation.
  contents.on('did-start-navigation', (_event, url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) navigate(url)
  })
  return navigate
}
