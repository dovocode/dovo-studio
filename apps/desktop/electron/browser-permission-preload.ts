/** Bridge permission requests/checks that Electron's boolean check cannot represent. */
export const BROWSER_PERMISSION_PRELOAD = `
if (process.isMainFrame) {
  const { contextBridge, ipcRenderer } = require('electron')
  contextBridge.executeInMainWorld({
    func: (request) => {
      const native = globalThis.queryLocalFonts
      if (typeof native !== 'function') return
      const apply = Reflect.apply
      Object.defineProperty(globalThis, 'queryLocalFonts', {
        configurable: true, writable: true,
        value: async function(...args) {
          if (!isSecureContext || window.top !== window)
            throw new DOMException('Local fonts require a secure main frame.', 'NotAllowedError')
          if (!(await request()))
            throw new DOMException('Local font access was denied.', 'NotAllowedError')
          return apply(native, globalThis, args)
        },
      })
    },
    args: [() => ipcRenderer.invoke('browser-permission:local-fonts')],
  })
  const idle = contextBridge.executeInMainWorld({
    func: (read) => {
      if (!isSecureContext || typeof IdleDetector !== 'function') return
      const permissions = navigator.permissions
      const query = permissions.query
      const request = IdleDetector.requestPermission
      const apply = Reflect.apply
      const define = Object.defineProperty
      const add = EventTarget.prototype.addEventListener
      const dispatch = EventTarget.prototype.dispatchEvent
      const stop = Event.prototype.stopImmediatePropagation
      const ChangeEvent = Event
      const statuses = new Set()
      const refresh = async () => {
        const state = await read()
        if (state === null) return
        for (const entry of statuses) {
          const status = entry.reference.deref()
          if (!status) { statuses.delete(entry); continue }
          if (entry.state === state) continue
          entry.state = state
          apply(dispatch, status, [new ChangeEvent('change')])
        }
      }
      define(permissions, 'query', {
        configurable: true, writable: true,
        value: async function(descriptor) {
          const status = await apply(query, this, arguments)
          // Keep Chromium's validation and Permissions Policy restrictions intact.
          if (this !== permissions || descriptor?.name !== 'idle-detection' ||
              !document.featurePolicy.allowsFeature('idle-detection')) return status
          const state = await read()
          if (state === null) return status
          const entry = { reference: new WeakRef(status), state }
          statuses.add(entry)
          define(status, 'state', { configurable: true, get: () => entry.state })
          apply(add, status, ['change', (event) => {
            if (!event.isTrusted) return
            apply(stop, event, [])
            void refresh()
          }, true])
          return status
        },
      })
      define(IdleDetector, 'requestPermission', {
        configurable: true, writable: true,
        value: async function() {
          try { return await apply(request, this, arguments) }
          finally { await refresh() }
        },
      })
      return { refresh }
    },
    args: [async () => {
      try { return await ipcRenderer.invoke('browser-permission:idle-state') }
      catch (error) {
        // Session preloads also run in unmanaged OAuth/extension popups. Those keep
        // Chromium's native denied state rather than gaining a Studio permission bridge.
        if (error.message.includes("No handler registered for 'browser-permission:idle-state'")) return null
        throw error
      }
    }],
  })
  ipcRenderer.on('browser-permission:idle-changed', () => idle?.refresh())
}
`

/** Electron supplies neither background execution controller. Make feature detection truthful. */
export const BROWSER_UNAVAILABLE_BACKGROUND_PRELOAD = `
require('electron').contextBridge.executeInMainWorld({
  func: () => {
    if (typeof ServiceWorkerRegistration === 'undefined') return
    for (const name of ['sync', 'periodicSync', 'backgroundFetch'])
      delete ServiceWorkerRegistration.prototype[name]
  },
})
`
