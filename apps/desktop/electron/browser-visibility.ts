import { app, ipcMain } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Runs in each frame/world before website scripts. Keep this function self-contained. */
export function installBrowserVisibility(initial: boolean | null, notify: boolean) {
  const nativeState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')!
  const nativeHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')!
  const getVisibility = (target: Document): DocumentVisibilityState => nativeState.get!.call(target)
  const getHidden = (target: Document): boolean => nativeHidden.get!.call(target)
  const dispatch = document.dispatchEvent.bind(document)
  const add = document.addEventListener.bind(document)
  const VisibilityEvent = Event
  let selected = initial
  const state = () =>
    selected === null ? getVisibility(document) : selected ? 'visible' : 'hidden'
  Object.defineProperties(Document.prototype, {
    visibilityState: {
      ...nativeState,
      get: function (this: Document) {
        const native = getVisibility(this)
        return this === document ? state() : native
      },
    },
    hidden: {
      ...nativeHidden,
      get: function (this: Document) {
        const native = getHidden(this)
        return this === document ? state() === 'hidden' : native
      },
    },
  })
  if (notify)
    add(
      'visibilitychange',
      (event: Event) => {
        // Native view occlusion and backgroundThrottling disagree with tab selection.
        // Once Studio owns this page, only actual public state transitions are delivered.
        if (selected !== null && event.isTrusted) event.stopImmediatePropagation()
      },
      true,
    )
  return (visible: boolean) => {
    const previous = state()
    selected = visible
    if (notify && previous !== state())
      dispatch(new VisibilityEvent('visibilitychange', { bubbles: true }))
  }
}

const PRELOAD = `{
  const { contextBridge, ipcRenderer } = require('electron')
  const initial = ipcRenderer.sendSync('browser:visibility-state')
  const install = ${installBrowserVisibility.toString()}
  const isolated = install(initial === true || initial === false ? initial : null, false)
  const page = contextBridge.executeInMainWorld({
    func: install,
    args: [initial === true || initial === false ? initial : null, true],
  })
  ipcRenderer.on('browser:visibility', (_event, visible) => {
    if (typeof visible !== 'boolean') return
    isolated(visible)
    page(visible)
  })
}`

/** Selection is independent of painting/throttling, including while menus use live frames. */
export function createBrowserVisibility(
  visible: (contents: Electron.WebContents) => boolean | undefined,
) {
  const sessions = new Map<Electron.Session, string>()
  const reported = new Map<Electron.WebContents, boolean>()
  let sync: ReturnType<typeof setTimeout> | undefined
  const initial = (event: Electron.IpcMainEvent) => {
    // Every session page must get a reply, including untracked native popups/extensions.
    // A null answer preserves their native lifecycle until adopted as a Studio tab.
    const state = visible(event.sender)
    if (state !== undefined && !reported.has(event.sender)) reported.set(event.sender, state)
    schedule()
    event.returnValue = state ?? null
  }
  ipcMain.on('browser:visibility-state', initial)
  const report = (contents: Electron.WebContents) => {
    if (contents.isDestroyed()) return
    const state = visible(contents)
    if (state === undefined) return
    reported.set(contents, state)
    schedule()
    contents.send('browser:visibility', state)
    for (const frame of contents.mainFrame.framesInSubtree) {
      if (frame === contents.mainFrame || frame.detached) continue
      frame.send('browser:visibility', state)
    }
  }
  // macOS can change isVisible (including native occlusion) without a show/hide event.
  // Events and tab commands deliver immediately; this bounds missed native transitions to 250ms.
  const schedule = () => {
    if (sync || !reported.size) return
    sync = setTimeout(() => {
      sync = undefined
      for (const [contents, previous] of reported) {
        const current = contents.isDestroyed() ? undefined : visible(contents)
        if (current === undefined) reported.delete(contents)
        else if (current !== previous) report(contents)
      }
      schedule()
    }, 250)
    sync.unref()
  }
  return {
    attachSession(session: Electron.Session) {
      if (sessions.has(session)) return
      const directory = join(app.getPath('userData'), 'browser-visibility')
      mkdirSync(directory, { recursive: true })
      const filePath = join(directory, 'preload.js')
      writeFileSync(filePath, PRELOAD)
      sessions.set(
        session,
        session.registerPreloadScript({ id: 'dovo-browser-visibility', type: 'frame', filePath }),
      )
    },
    report,
    dispose() {
      clearTimeout(sync)
      reported.clear()
      ipcMain.removeListener('browser:visibility-state', initial)
      for (const [session, id] of sessions) session.unregisterPreloadScript(id)
      sessions.clear()
    },
  }
}
