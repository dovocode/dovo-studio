import { randomUUID } from 'node:crypto'
import { DOCUMENT_PIP_HEADER_HEIGHT } from './browser-document-pip-controls.js'
export { createDocumentPipWindow } from './browser-document-pip-controls.js'

/** A regular same-origin window avoids Electron's broken native Document PiP owner. */
export const DOCUMENT_PIP_NAME = '__dovo_document_picture_in_picture__'

/** One-use window tickets keep a site's ordinary window.open from creating topmost windows. */
export function authorizeDocumentPip(
  contents: Electron.WebContents,
  automaticAllowed: () => boolean,
) {
  let ticket: { name: string; frame: Electron.WebFrameMain; expires: number } | undefined
  contents.ipc.handle(
    'browser:document-pip-auto',
    (event) => event.senderFrame === contents.mainFrame && automaticAllowed(),
  )
  contents.ipc.handle(
    'browser:document-pip-authorize',
    (event, active: unknown, automatic: unknown) => {
      if (
        event.senderFrame !== contents.mainFrame ||
        !(active === true || (automatic === true && automaticAllowed()))
      )
        return null
      ticket = {
        name: `${DOCUMENT_PIP_NAME}:${randomUUID()}`,
        frame: contents.mainFrame,
        expires: Date.now() + 1000,
      }
      return ticket.name
    },
  )
  return (details: Electron.HandlerDetails) => {
    if (
      !ticket ||
      details.frameName !== ticket.name ||
      ticket.frame !== contents.mainFrame ||
      Date.now() > ticket.expires
    )
      return
    ticket = undefined
    return documentPipWindowOptions(details, contents.getURL())
  }
}

export function documentPipWindowOptions(
  details: Electron.HandlerDetails,
  opener: string,
): Electron.BrowserWindowConstructorOptions | undefined {
  if (!details.frameName.startsWith(`${DOCUMENT_PIP_NAME}:`) || details.url !== 'about:blank')
    return
  const url = new URL(opener)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    return
  const dimension = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(new RegExp(`(?:^|,)${name}=([0-9]+)(?:,|$)`).exec(details.features)?.[1])
    return Math.max(min, Math.min(max, value || fallback))
  }
  return {
    frame: false,
    alwaysOnTop: true,
    useContentSize: true,
    autoHideMenuBar: true,
    width: dimension('width', 480, 240, 1920),
    height: dimension('height', 320, 160, 1080) + DOCUMENT_PIP_HEADER_HEIGHT,
    minWidth: 240,
    minHeight: 160 + DOCUMENT_PIP_HEADER_HEIGHT,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      disableBlinkFeatures: 'DocumentPictureInPictureAPI',
    },
  }
}

/** Runs before website scripts in the main world. Keep this function self-contained. */
export function installDocumentPictureInPicture(
  automaticAllowed: () => Promise<boolean>,
  authorize: (automatic: boolean) => Promise<string | null>,
) {
  if (
    window !== window.top ||
    !window.isSecureContext ||
    window.opener ||
    !/^https?:$/.test(location.protocol)
  )
    return
  type Options = {
    width?: number
    height?: number
    disallowReturnToOpener?: boolean
    preferInitialWindowPlacement?: boolean
  }
  // Capture the real primitives before a website replaces them.
  const open = window.open.bind(window)
  const close = window.close
  const apply = Reflect.apply
  // Bind Function.call to each captured native method; receivers are supplied explicitly below.
  const dispatch = EventTarget.prototype.dispatchEvent.call.bind(
    EventTarget.prototype.dispatchEvent,
  )
  const add = EventTarget.prototype.addEventListener.call.bind(
    EventTarget.prototype.addEventListener,
  )
  let current: Window | null = null
  let automatic = false
  let enterHandler: ((event: Event) => void) | null = null
  const token = Symbol()
  class DocumentPictureInPictureEvent extends Event {
    declare readonly window: Window
    constructor(type: string, init: EventInit & { window: Window }) {
      super(type, init)
      if (!init?.window || init.window.window !== init.window)
        throw new TypeError('A PiP event requires a Window.')
      Object.defineProperty(this, 'window', { value: init.window, enumerable: true })
    }
  }
  class DocumentPictureInPicture extends EventTarget {
    constructor(secret: symbol) {
      super()
      if (secret !== token) throw new TypeError('Illegal constructor')
    }
    async requestWindow(options: Options = {}) {
      if (this !== api) throw new TypeError('Illegal invocation')
      if (!navigator.userActivation.isActive && !automatic)
        throw new DOMException('Document PiP requires a user gesture.', 'NotAllowedError')
      const width = Number(options.width ?? 0)
      const height = Number(options.height ?? 0)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0)
        throw new TypeError('PiP dimensions must be finite non-negative numbers.')
      if (width > 0 !== height > 0)
        throw new RangeError('Provide both a width and a height, or neither.')
      const name = await authorize(automatic)
      if (!name)
        throw new DOMException(
          'Document PiP requires a user gesture or automatic-PiP approval.',
          'NotAllowedError',
        )
      if (current && !current.closed) apply(close, current, [])
      current = null
      const child = open(
        'about:blank',
        name,
        `popup,width=${Math.min(1920, Math.max(240, width || 480))},height=${Math.min(1080, Math.max(160, height || 320))},dovo-disallow-return=${options.disallowReturnToOpener ? 1 : 0}`,
      )
      if (!child) throw new DOMException('The PiP window could not open.', 'NotAllowedError')
      current = child
      // Relative links and assets retain the opener's base, just as in Document PiP.
      const base = child.document.createElement('base')
      base.href = document.baseURI
      child.document.head.append(base)
      child.document.title = document.title
      add(
        child,
        'pagehide',
        () => {
          if (current === child) current = null
        },
        { once: true },
      )
      const event = new DocumentPictureInPictureEvent('enter', { window: child })
      dispatch(api, event)
      return child
    }
    get window() {
      return current?.closed ? null : current
    }
    get onenter() {
      return enterHandler
    }
    set onenter(handler: ((event: Event) => void) | null) {
      if (enterHandler) this.removeEventListener('enter', enterHandler)
      enterHandler = typeof handler === 'function' ? handler : null
      if (enterHandler) this.addEventListener('enter', enterHandler)
    }
  }
  const api = new DocumentPictureInPicture(token)
  Object.defineProperties(window, {
    DocumentPictureInPicture: { value: DocumentPictureInPicture, configurable: true },
    DocumentPictureInPictureEvent: { value: DocumentPictureInPictureEvent, configurable: true },
    documentPictureInPicture: { value: api, configurable: true },
  })
  add(window, 'pagehide', () => {
    if (current && !current.closed) apply(close, current, [])
    current = null
  })
  // Electron lacks Chrome's automatic Media Session action. Sites still own their call UI;
  // Studio invokes it only when the site has an explicit automatic-PiP approval.
  if (!navigator.mediaSession) return
  const nativeSet = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
  let handler: ((details: { reason: string }) => unknown) | null = null
  navigator.mediaSession.setActionHandler = (action, callback) => {
    if (String(action) === 'enterpictureinpicture') {
      handler = callback ? (details) => callback({ action, ...details }) : null
      return
    }
    nativeSet(action, callback)
  }
  let entering = false
  let wasHidden = document.hidden
  add(document, 'visibilitychange', async () => {
    const hidden = document.hidden
    const changed = hidden !== wasHidden
    wasHidden = hidden
    // Native occlusion events can repeat while Studio already considers this page hidden.
    // Closing a PiP should not immediately reopen it without another leave transition.
    if (!changed || !hidden || !handler || current || entering) return
    entering = true
    try {
      if (
        !(await automaticAllowed()) ||
        document.visibilityState !== 'hidden' ||
        !handler ||
        current
      )
        return
      automatic = true
      await handler({ reason: 'contentoccluded' })
    } finally {
      automatic = false
      entering = false
    }
  })
}

export const DOCUMENT_PIP_PRELOAD = `
if (process.isMainFrame) {
contextBridge.executeInMainWorld({
  func: ${installDocumentPictureInPicture.toString()},
  args: [
    () => ipcRenderer.invoke('browser:document-pip-auto'),
    (automatic) => ipcRenderer.invoke('browser:document-pip-authorize', navigator.userActivation.isActive, automatic),
  ],
})
}
`
