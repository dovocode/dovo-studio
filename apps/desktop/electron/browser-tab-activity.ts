import { browserTabBadge } from '@dovo/protocol'

type Devices = { camera: boolean; microphone: boolean; screenSharing: boolean }
const idle = (): Devices => ({ camera: false, microphone: false, screenSharing: false })

/** Runs before website scripts in every frame. Keep this function self-contained. */
export function installBrowserTabActivity(
  report: (state: { camera: boolean; microphone: boolean; screenSharing: boolean }) => void,
  badge: (value: number | 'unread' | null) => void,
) {
  if (window === window.top && window.isSecureContext) {
    const set = navigator.setAppBadge?.bind(navigator)
    const clear = navigator.clearAppBadge?.bind(navigator)
    Object.defineProperties(navigator, {
      setAppBadge: {
        configurable: true,
        value: async (value?: number) => {
          if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
            throw new TypeError('Badge count must be a non-negative safe integer.')
          await set?.(value)
          badge(value === undefined ? 'unread' : value || null)
        },
      },
      clearAppBadge: {
        configurable: true,
        value: async () => {
          await clear?.()
          badge(null)
        },
      },
    })
  }
  if (!navigator.mediaDevices || typeof MediaStreamTrack === 'undefined') return
  const apply = Reflect.apply
  const then = Promise.prototype.then
  const getTracks = MediaStream.prototype.getTracks
  const prototype = MediaStreamTrack.prototype
  const ready = Object.getOwnPropertyDescriptor(prototype, 'readyState')!.get!
  const enabled = Object.getOwnPropertyDescriptor(prototype, 'enabled')!.get!
  const muted = Object.getOwnPropertyDescriptor(prototype, 'muted')!.get!
  const kind = Object.getOwnPropertyDescriptor(prototype, 'kind')!.get!
  const clone = prototype.clone
  const tracks = new Map<MediaStreamTrack, 'camera' | 'microphone' | 'screenSharing'>()
  let timer: ReturnType<typeof setInterval> | undefined
  let previous = ''
  const update = () => {
    const state = { camera: false, microphone: false, screenSharing: false }
    for (const [track, device] of tracks) {
      if (apply(ready, track, []) !== 'live') tracks.delete(track)
      else if (apply(enabled, track, []) && !apply(muted, track, [])) state[device] = true
    }
    const signature = JSON.stringify(state)
    if (signature !== previous) {
      previous = signature
      report(state)
    }
    if (!tracks.size) {
      clearInterval(timer)
      timer = undefined
    }
  }
  prototype.clone = function () {
    const child = apply(clone, this, [])
    const device = tracks.get(this)
    if (device) tracks.set(child, device)
    return child
  }
  const devices = MediaDevices.prototype
  for (const method of ['getUserMedia', 'getDisplayMedia'] as const) {
    const original = devices[method]
    if (typeof original !== 'function') continue
    Object.defineProperty(devices, method, {
      configurable: true,
      writable: true,
      value: function (this: MediaDevices, ...args: unknown[]) {
        return apply(then, apply(original, this, args), [
          (stream: MediaStream) => {
            for (const track of apply(getTracks, stream, []))
              tracks.set(
                track,
                method === 'getDisplayMedia'
                  ? 'screenSharing'
                  : apply(kind, track, []) === 'video'
                    ? 'camera'
                    : 'microphone',
              )
            timer ??= setInterval(update, 500)
            update()
            return stream
          },
        ])
      },
    })
  }
  window.addEventListener('pagehide', () => {
    clearInterval(timer)
    timer = undefined
    tracks.clear()
    update()
  })
  update()
}

export const BROWSER_TAB_ACTIVITY_PRELOAD = `
contextBridge.executeInMainWorld({
  func: ${installBrowserTabActivity.toString()},
  args: [
    state => ipcRenderer.send('browser:tab-devices', state),
    value => ipcRenderer.send('browser:tab-badge', value),
  ],
})
`

/** Per-frame reports are snapshots, independent of permission grants and selected tab. */
export function createBrowserTabActivity(contents: Electron.WebContents) {
  const frames = new Map<Electron.WebFrameMain, Devices>()
  let badge: number | 'unread' | undefined
  contents.ipc.on('browser:tab-badge', (event, value: unknown) => {
    if (event.senderFrame !== contents.mainFrame) return
    if (value === null) badge = undefined
    else if (
      value === 'unread' ||
      (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    )
      badge = value
  })
  contents.ipc.on('browser:tab-devices', (event, value: unknown) => {
    const frame = event.senderFrame
    if (
      !frame ||
      (frame !== contents.mainFrame && !contents.mainFrame.framesInSubtree.includes(frame)) ||
      !value ||
      typeof value !== 'object'
    )
      return
    const camera: unknown = Reflect.get(value, 'camera')
    const microphone: unknown = Reflect.get(value, 'microphone')
    const screenSharing: unknown = Reflect.get(value, 'screenSharing')
    if (
      typeof camera !== 'boolean' ||
      typeof microphone !== 'boolean' ||
      typeof screenSharing !== 'boolean'
    )
      return
    frames.set(frame, { camera, microphone, screenSharing })
  })
  contents.on('did-navigate', () => {
    frames.clear()
    badge = undefined
  })
  return () => {
    const state = idle()
    for (const [frame, devices] of frames) {
      if (frame.detached) {
        frames.delete(frame)
        continue
      }
      state.camera ||= devices.camera
      state.microphone ||= devices.microphone
      state.screenSharing ||= devices.screenSharing
    }
    return { ...state, badge: badge ?? browserTabBadge(contents.getTitle()) }
  }
}
