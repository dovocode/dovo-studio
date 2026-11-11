import {
  BrowserWindow,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron'

const views = new WeakMap<BrowserWindow, { view: WebContentsView; contents: WebContents }>()

/** Keep the Studio renderer and web pages as siblings. Native child views always paint
 * above BrowserWindow's built-in renderer, even above CSS portals and top-layer dialogs. */
export function createStudioWindow(options: BrowserWindowConstructorOptions) {
  const window = new BrowserWindow({
    ...options,
    // The shell never loads application or website code. Only the UI view gets the bridge.
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const ui = new WebContentsView({ webPreferences: options.webPreferences })
  ui.setBackgroundColor('#00000000')
  const contents = ui.webContents
  views.set(window, { view: ui, contents })
  window.contentView.addChildView(ui)
  const resize = () => {
    const { width, height } = window.contentView.getBounds()
    ui.setBounds({ x: 0, y: 0, width, height })
  }
  resize()
  window.on('resize', resize)
  window.contentView.on('bounds-changed', resize)
  contents.once('destroyed', () => {
    setImmediate(() => {
      if (!window.isDestroyed()) window.close()
    })
  })
  window.once('closed', () => {
    if (!contents.isDestroyed()) contents.close()
  })
  let closing = false
  contents.on('will-prevent-unload', (event) => {
    queueMicrotask(() => {
      if (!event.defaultPrevented) closing = false
    })
  })
  contents.on('render-process-gone', () => {
    closing = false
  })
  contents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) closing = false
  })
  // Install after callers' synchronous close guards (for example, returning detached tabs).
  queueMicrotask(() => {
    if (window.isDestroyed()) return
    window.on('close', (event) => {
      if (event.defaultPrevented || contents.isDestroyed()) return
      event.preventDefault()
      if (!closing) {
        closing = true
        contents.close({ waitForBeforeUnload: true })
      }
    })
  })
  const focus = () => {
    if (!contents.isDestroyed() && window.webContents.isFocused()) contents.focus()
  }
  window.on('focus', focus)
  if (window.isVisible()) focus()
  contents.on('page-title-updated', (_event, title) => window.setTitle(title))
  return window
}

/** Plain website/extension windows still use their built-in renderer. */
export function studioContents(window: BrowserWindow) {
  return views.get(window)?.contents ?? window.webContents
}

export function raiseStudioOverlay(window: BrowserWindow) {
  const ui = views.get(window)?.view
  if (!ui) return false
  if (window.contentView.children.at(-1) !== ui) window.contentView.addChildView(ui)
  return true
}
