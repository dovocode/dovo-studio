import type { BrowserCapture, BrowserMediaRequest } from '@dovo/protocol'
import { app, desktopCapturer, systemPreferences, webContents as allContents } from 'electron'
import { browserPermissions } from './browser-permissions.js'
import { openRemoteMedia } from './browser-remote-media.js'
import type { ThreadWindowTarget } from '@dovo/protocol'
import type { BrowserCommand } from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A shared-browser tab, as browser.ts tracks it. Thread previews never appear here. */
export type MediaTab = {
  key: string
  windowId: number
  profileId: string
  contents: Electron.WebContents
}
export type MediaHost = {
  tabFor(contents: Electron.WebContents): MediaTab | undefined
  /** All local shared-browser tabs, including other profiles and windows. */
  tabs(): MediaTab[]
  openThread?(
    target: ThreadWindowTarget,
  ): Promise<{ contents: Electron.WebContents; close: () => void }>
}
type Pending = BrowserMediaRequest & {
  windowId: number
  contents: Electron.WebContents
  answer: (allow: false | Electron.Streams | true) => void
  timer: ReturnType<typeof setTimeout>
  desktopSources?: Electron.DesktopCapturerSource[]
}
type Capture = BrowserCapture & {
  windowId: number
  /** The capturing page, and the exact main frame the request was approved for. */
  contents: Electron.WebContents
  frame: { processId: number; routingId: number }
  /** The shared tab. Chromium's capturer count on it is the only proof a capture is live. */
  source?: Electron.WebContents
  closeSource?: () => void
  approvedAt: number
  /** Chromium has counted this tab as captured at least once since approval. */
  seen: boolean
  stopAt?: number
  /** The page's own capture number, used only to ask its tracker to stop. */
  pageId?: string
}

const REQUEST_TIMEOUT = 60_000
/** An approved capture that Chromium never starts is dropped after this. */
const START_GRACE = 10_000
/** A page that still holds its tracks this long after Stop is reported as unresponsive. */
const STOP_GRACE = 5_000
const MAX_PENDING_PER_WINDOW = 6
/**
 * Runs in each shared-browser page's main frame before page scripts. It wraps the real
 * `getDisplayMedia`, keeps the real tracks, and reports when they truly end, using getters
 * captured before any page script could replace them. Stop calls the real `track.stop()` and
 * dispatches `ended`, like Chromium's own "Stop sharing" button, so call apps update their UI.
 */
const PRELOAD = `const { contextBridge, ipcRenderer } = require('electron')
if (process.isMainFrame) {
  const controller = contextBridge.executeInMainWorld({
    func: (report) => {
      // Capture every builtin now, before page scripts can replace them, and avoid iterators,
      // spreads and prototype lookups at call time.
      const apply = Reflect.apply
      const define = Object.defineProperty
      const devices = MediaDevices.prototype
      const original = devices.getDisplayMedia
      if (typeof original !== 'function') return undefined
      const then = Promise.prototype.then
      const interval = setInterval
      const cancel = clearInterval
      const readyState = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'readyState').get
      const getTracks = MediaStream.prototype.getTracks
      const stopTrack = MediaStreamTrack.prototype.stop
      const kind = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'kind').get
      const dispatch = EventTarget.prototype.dispatchEvent
      const EndedEvent = Event
      const own = (target, index, value) =>
        define(target, index, { value, writable: true, enumerable: true, configurable: true })
      const captures = []
      let next = 0
      const getDisplayMedia = function getDisplayMedia() {
        return apply(then, apply(original, this, arguments), [
          (stream) => {
            const tracks = apply(getTracks, stream, [])
            const kinds = []
            for (let index = 0; index < tracks.length; index++)
              own(kinds, index, apply(kind, tracks[index], []))
            const id = '' + ++next
            own(captures, captures.length, { id, tracks })
            report('started', id, kinds)
            const timer = interval(() => {
              for (let index = 0; index < tracks.length; index++)
                if (apply(readyState, tracks[index], []) === 'live') return
              cancel(timer)
              report('ended', id, [])
            }, 500)
            return stream
          },
          (error) => {
            report('failed', '', [])
            throw error
          },
        ])
      }
      define(devices, 'getDisplayMedia', { value: getDisplayMedia, writable: true, configurable: true })
      return {
        stop: (id) => {
          for (let index = 0; index < captures.length; index++) {
            if (captures[index].id !== id) continue
            const tracks = captures[index].tracks
            for (let item = 0; item < tracks.length; item++) {
              apply(stopTrack, tracks[item], [])
              apply(dispatch, tracks[item], [new EndedEvent('ended')])
            }
          }
        },
      }
    },
    args: [(phase, id, kinds) => ipcRenderer.send('browser-media:track', { phase, id, kinds })],
  })
  ipcRenderer.on('browser-media:stop', (_event, id) => controller?.stop(String(id)))
}
`

/** `https://host[:port]` for web pages; anything else cannot request media. */
const webOrigin = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined
  } catch {
    return undefined
  }
}
const mediaTypes = (details: unknown) => {
  const types: unknown =
    details && typeof details === 'object' ? Reflect.get(details, 'mediaTypes') : undefined
  if (!Array.isArray(types) || !types.length) return undefined
  if (!types.every((type) => type === 'audio' || type === 'video')) return undefined
  return { audio: types.includes('audio'), video: types.includes('video') }
}

export function createBrowserMedia(host: MediaHost) {
  const pending = new Map<string, Pending>()
  const captures = new Map<string, Capture>()
  /** Camera/microphone answers belong to one live document, never another tab at that origin. */
  const grants = new Map<
    number,
    {
      profileId: string
      origin: string
      processId: number
      routingId: number
      audio: boolean
      video: boolean
    }
  >()
  type RemoteSource = Extract<BrowserCommand, { action: 'remote-media-sources' }>['sources'][number]
  const threadSources = new Map<number, ThreadWindowTarget[]>()
  const remoteSources = new Map<number, RemoteSource[]>()
  const sessions = new WeakSet<Electron.Session>()
  const removeCapture = (id: string) => {
    const capture = captures.get(id)
    captures.delete(id)
    capture?.closeSource?.()
  }
  const tabsAttached = new WeakSet<Electron.WebContents>()
  let preload: string | undefined
  const grantFor = (contents: Electron.WebContents, profileId: string, origin: string) => {
    const grant = grants.get(contents.id)
    const frame = contents.mainFrame
    return grant?.profileId === profileId &&
      grant.origin === origin &&
      grant.processId === frame.processId &&
      grant.routingId === frame.routingId
      ? grant
      : undefined
  }

  const settle = (request: Pending, allow: false | Electron.Streams | true) => {
    if (!pending.delete(request.id)) return
    clearTimeout(request.timer)
    request.answer(allow)
  }
  const add = (request: Omit<Pending, 'id' | 'expiresAt' | 'timer'>): void => {
    // One open request of each kind per tab; a newer one replaces (and denies) the older.
    for (const other of pending.values())
      if (other.contents.id === request.contents.id && other.kind === request.kind)
        settle(other, false)
    if (
      [...pending.values()].filter((other) => other.windowId === request.windowId).length >=
      MAX_PENDING_PER_WINDOW
    )
      return request.answer(false)
    const id = randomUUID()
    const entry: Pending = {
      ...request,
      id,
      expiresAt: Date.now() + REQUEST_TIMEOUT,
      timer: setTimeout(() => settle(entry, false), REQUEST_TIMEOUT),
    }
    pending.set(id, entry)
  }
  /** The requesting page must still be the same document origin it was when it asked. */
  const unchanged = (request: Pending) => {
    if (request.contents.isDestroyed()) return false
    const tab = host.tabFor(request.contents)
    return (
      tab?.key === request.key &&
      tab.windowId === request.windowId &&
      tab.profileId === request.profileId &&
      webOrigin(request.contents.mainFrame.url) === request.origin
    )
  }
  /** Pending requests die with their page; captures are judged only by Chromium (`refresh`). */
  const forgetContents = (contents: Electron.WebContents) => {
    grants.delete(contents.id)
    for (const [id, capture] of captures)
      if (!capture.source && capture.contents.id === contents.id) removeCapture(id)
    for (const request of [...pending.values()])
      if (request.contents.id === contents.id) settle(request, false)
  }
  /**
   * Chromium's capturer count on the shared tab decides what is listed. Page reports can name a
   * capture for Stop but can never end one, so a forged or failed report cannot hide sharing.
   */
  const refresh = () => {
    const now = Date.now()
    for (const [id, capture] of captures) {
      if (capture.source?.isDestroyed() || (!capture.source && capture.contents.isDestroyed())) {
        removeCapture(id)
        continue
      }
      if (!capture.source && !capture.seen && now - capture.approvedAt >= START_GRACE)
        capture.unresponsive = true
      const live = capture.source ? capture.source.isBeingCaptured() : capture.seen
      if (live) {
        capture.seen = true
        if (capture.state === 'starting') capture.state = 'active'
        if (capture.state === 'stopping' && now - (capture.stopAt ?? now) >= STOP_GRACE)
          capture.unresponsive = true
      } else if (capture.source && (capture.seen || now - capture.approvedAt >= START_GRACE))
        removeCapture(id)
    }
  }
  const sameFrame = (frame: Electron.WebFrameMain | null | undefined, capture: Capture) =>
    !!frame &&
    frame.processId === capture.frame.processId &&
    frame.routingId === capture.frame.routingId
  const writePreload = () => {
    if (preload) return preload
    const directory = join(app.getPath('userData'), 'browser-media')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, 'capture.preload.js')
    writeFileSync(path, PRELOAD)
    return (preload = path)
  }

  return {
    setRemoteSources: (windowId: number, sources: RemoteSource[]) => {
      remoteSources.set(windowId, sources)
    },
    setThreadSources: (windowId: number, sources: ThreadWindowTarget[]) => {
      threadSources.set(windowId, sources)
    },
    releaseWindow: (windowId: number) => {
      remoteSources.delete(windowId)
      threadSources.delete(windowId)
    },
    /** Install media handling on a shared-browser profile session; thread previews never get it. */
    attachSession: (session: Electron.Session, profileId: string) => {
      if (sessions.has(session)) return
      sessions.add(session)
      session.registerPreloadScript({
        id: 'dovo-browser-media',
        type: 'frame',
        filePath: writePreload(),
      })
      session.setDisplayMediaRequestHandler((request, callback) => {
        const deny = () => callback(null)
        const frame = request.frame
        if (!frame || frame.parent !== null) return deny()
        const contents = allContents.fromFrame(frame)
        const tab = contents && host.tabFor(contents)
        const origin = webOrigin(frame.url)
        if (
          !contents ||
          !tab ||
          tab.profileId !== profileId ||
          !request.userGesture ||
          !request.videoRequested ||
          !origin ||
          webOrigin(request.securityOrigin) !== origin
        )
          return deny()
        // Nothing is chosen here: the request waits for the user's answer in the Studio window.
        add({
          kind: 'display',
          key: tab.key,
          profileId,
          origin,
          video: true,
          audio: request.audioRequested,
          windowId: tab.windowId,
          contents,
          answer: (allow) => {
            if (allow === false || allow === true) return deny()
            try {
              callback(allow)
            } catch {
              deny()
            }
          },
        })
        const entry = [...pending.values()].find(
          (item) => item.contents.id === contents.id && item.kind === 'display',
        )
        if (entry)
          void desktopCapturer
            .getSources({ types: ['window', 'screen'], thumbnailSize: { width: 240, height: 150 } })
            .then(
              (sources) => {
                if (pending.has(entry.id)) entry.desktopSources = sources
              },
              (error: unknown) => {
                if (pending.has(entry.id))
                  entry.sourceError =
                    error instanceof Error ? error.message : 'Desktop sources are unavailable.'
              },
            )
      })
      session.setPermissionRequestHandler((contents, permission, callback, details) => {
        const tab = host.tabFor(contents)
        if (!tab || tab.profileId !== profileId || !details.isMainFrame) return callback(false)
        const origin = webOrigin(details.requestingUrl)
        if (!origin || webOrigin(contents.mainFrame.url) !== origin) return callback(false)
        if (permission === 'notifications') {
          const saved = browserPermissions(profileId).notification(origin)
          if (saved !== undefined) return callback(saved)
          add({
            kind: 'notifications',
            key: tab.key,
            profileId,
            origin,
            video: false,
            audio: false,
            windowId: tab.windowId,
            contents,
            answer: (allow) => callback(allow === true),
          })
          return
        }
        // getDisplayMedia still waits for the display handler above before anything is shared.
        if (permission === 'display-capture') return callback(true)
        const types = permission === 'media' ? mediaTypes(details) : undefined
        if (!types) return callback(false)
        const granted = grantFor(contents, profileId, origin)
        if (granted && (!types.audio || granted.audio) && (!types.video || granted.video))
          return callback(true)
        add({
          kind: 'user-media',
          key: tab.key,
          profileId,
          origin,
          ...types,
          windowId: tab.windowId,
          contents,
          answer: (allow) => callback(allow !== false),
        })
      })
      session.setPermissionCheckHandler((contents, permission, origin, details) => {
        if (!contents)
          return (
            permission === 'notifications' &&
            !!webOrigin(origin) &&
            browserPermissions(profileId).notification(webOrigin(origin)!) === true
          )
        const tab = host.tabFor(contents)
        const page = webOrigin(origin)
        if (!tab || tab.profileId !== profileId || !page) return false
        // Chromium checks this before getDisplayMedia reaches the display handler, which still
        // waits for the user's choice; only the tab's own page origin passes.
        if (permission === 'display-capture') return webOrigin(contents.mainFrame.url) === page
        if (permission === 'notifications')
          return (
            webOrigin(contents.mainFrame.url) === page &&
            browserPermissions(profileId).notification(page) === true
          )
        if (permission !== 'media') return false
        const granted = grantFor(contents, profileId, page)
        const type: unknown = Reflect.get(details, 'mediaType')
        return (
          !!granted && (type === 'audio' ? granted.audio : type === 'video' ? granted.video : false)
        )
      })
    },
    /** Track the page's capture lifecycle for one shared-browser tab. */
    attachTab: (contents: Electron.WebContents) => {
      if (tabsAttached.has(contents)) return
      tabsAttached.add(contents)
      contents.ipc.on('browser-media:track', (event, raw: unknown) => {
        if (!raw || typeof raw !== 'object') return
        const phase: unknown = Reflect.get(raw, 'phase')
        const id: unknown = Reflect.get(raw, 'id')
        if (typeof id !== 'string' || id.length > 20) return
        // Only the main frame the request was approved for can name its capture, in order.
        const capture = [...captures.values()].find(
          (item) =>
            item.contents.id === contents.id &&
            (phase === 'ended' ? item.pageId === id : item.pageId === undefined) &&
            sameFrame(event.senderFrame, item),
        )
        if (!capture) return
        if (phase === 'started' && /^\d+$/.test(id)) {
          capture.pageId = id
          if (!capture.source) {
            capture.seen = true
            capture.state = 'active'
          }
        }
        // A rejected getDisplayMedia; dropped only if Chromium agrees nothing is captured.
        else if (phase === 'failed' && !capture.source?.isBeingCaptured()) removeCapture(capture.id)
        else if (phase === 'ended' && !capture.source) removeCapture(capture.id)
      })
      contents.on('did-navigate', () => forgetContents(contents))
      contents.on('did-start-navigation', (_event, _url, sameDocument, mainFrame) => {
        // A beforeunload dialog can cancel this navigation. Keep the current document's
        // device grant (and its call alive) until a new document actually commits.
        if (mainFrame && !sameDocument)
          for (const request of [...pending.values()])
            if (request.contents.id === contents.id) settle(request, false)
      })
      contents.on('render-process-gone', () => forgetContents(contents))
      contents.once('destroyed', () => forgetContents(contents))
    },
    /** Call before a tab's page is closed. */
    releaseTab: (contents: Electron.WebContents) => forgetContents(contents),
    /** Answer a pending request from the Studio window that lists it. */
    decide: async (
      windowId: number,
      command: {
        key: string
        requestId: string
        decision: 'allow' | 'deny'
        source?: string
        audio?: boolean
      },
    ) => {
      const request = pending.get(command.requestId)
      if (!request || request.windowId !== windowId || request.key !== command.key)
        throw new Error('This media request is no longer waiting for an answer.')
      if (command.decision === 'deny') {
        if (request.kind === 'notifications' && unchanged(request))
          browserPermissions(request.profileId).setNotification(request.origin, false)
        return settle(request, false)
      }
      if (!unchanged(request)) {
        settle(request, false)
        throw new Error('The page changed before you answered, so its request was denied.')
      }
      if (request.kind === 'notifications') {
        browserPermissions(request.profileId).setNotification(request.origin, true)
        return settle(request, true)
      }
      if (request.kind === 'user-media') {
        if (process.platform === 'darwin')
          for (const [type, wanted] of [
            ['camera', request.video],
            ['microphone', request.audio],
          ] as const)
            if (
              wanted &&
              systemPreferences.getMediaAccessStatus(type) !== 'granted' &&
              !(await systemPreferences.askForMediaAccess(type))
            ) {
              settle(request, false)
              throw new Error(
                `macOS has not allowed Dovo to use the ${type}. Allow it in System Settings → Privacy & Security.`,
              )
            }
        if (!unchanged(request) || !pending.has(request.id)) {
          settle(request, false)
          throw new Error('The page changed before you answered, so its request was denied.')
        }
        const previous = grantFor(request.contents, request.profileId, request.origin)
        grants.set(request.contents.id, {
          profileId: request.profileId,
          origin: request.origin,
          processId: request.contents.mainFrame.processId,
          routingId: request.contents.mainFrame.routingId,
          audio: request.audio || !!previous?.audio,
          video: request.video || !!previous?.video,
        })
        return settle(request, true)
      }
      const source = host
        .tabs()
        .find(
          (tab) =>
            tab.key === command.source &&
            !tab.contents.isDestroyed() &&
            webOrigin(tab.contents.mainFrame.url),
        )
      const remote = remoteSources.get(windowId)?.find((tab) => tab.key === command.source)
      const thread = threadSources
        .get(windowId)
        ?.find((item) => `thread:${item.runtimeId}:${item.taskId}` === command.source)
      const desktop = request.desktopSources?.find((item) => item.id === command.source)
      if (!source && !remote && !desktop && !thread)
        throw new Error('Choose an available tab, window or screen to share.')
      refresh()
      // Chromium reports aggregate capturer counts. Keep one grant per source so a stopped
      // stream cannot be confused with another caller that still captures that source.
      if (
        source &&
        ([...captures.values()].some((capture) => capture.source?.id === source.contents.id) ||
          source.contents.isBeingCaptured())
      )
        throw new Error('This tab is already being shared. Stop its current share first.')
      // Preload completion reports carry a page-local ID. Serialize approvals until that ID
      // arrives, so out-of-order promise completion cannot attach Stop to the wrong stream.
      if (
        [...captures.values()].some(
          (capture) => capture.contents.id === request.contents.id && capture.pageId === undefined,
        )
      )
        throw new Error('Wait for this page’s previous share to start before sharing another tab.')
      const audio = !!command.audio
      if (audio && !request.audio) throw new Error('This page did not ask for tab audio.')
      if (audio && !source) throw new Error('Audio is available for local browser tabs only.')
      const opened = remote
        ? await openRemoteMedia(remote)
        : thread
          ? await host.openThread?.(thread)
          : undefined
      if (!unchanged(request) || !pending.has(request.id)) {
        opened?.close()
        throw new Error('The page changed before sharing could start.')
      }
      const contents = source?.contents ?? opened?.contents
      const video = contents?.mainFrame ?? desktop
      if (!video) {
        opened?.close()
        throw new Error('This source is no longer available.')
      }
      settle(request, {
        video,
        ...(audio && contents ? { audio: contents.mainFrame, enableLocalEcho: true } : {}),
      })
      const id = randomUUID()
      const requester = request.contents.mainFrame
      captures.set(id, {
        id,
        key: request.key,
        sourceKey: command.source!,
        ...(!source
          ? {
              sourceKind: thread
                ? ('thread' as const)
                : remote
                  ? ('remote' as const)
                  : desktop!.id.startsWith('screen:')
                    ? ('screen' as const)
                    : ('window' as const),
              sourceTitle: thread?.title ?? remote?.title ?? desktop?.name,
              sourceUrl: remote?.url,
            }
          : {}),
        profileId: request.profileId,
        origin: request.origin,
        audio,
        state: 'starting',
        windowId,
        contents: request.contents,
        frame: { processId: requester.processId, routingId: requester.routingId },
        source: contents,
        closeSource: opened?.close,
        approvedAt: Date.now(),
        seen: false,
      })
    },
    /** Ask the capturing page to stop its real tracks; the capture stays listed until they end. */
    stop: (windowId: number, command: { key: string; captureId: string }) => {
      refresh()
      const capture = captures.get(command.captureId)
      if (!capture || capture.windowId !== windowId || capture.key !== command.key)
        throw new Error('This tab is no longer being shared.')
      if (capture.state === 'starting')
        throw new Error('The page has not started sharing yet. Try again in a moment.')
      const page = capture.contents.isDestroyed() ? undefined : capture.contents.mainFrame
      if (capture.pageId === undefined || !sameFrame(page, capture)) {
        capture.unresponsive = true
        throw new Error(
          'Dovo cannot stop this page’s sharing from here. Close the page to stop it.',
        )
      }
      // Never navigate or reload: the page stops its own real tracks and keeps its state.
      if (capture.state !== 'stopping') {
        capture.state = 'stopping'
        capture.stopAt = Date.now()
      }
      capture.contents.send('browser-media:stop', capture.pageId)
    },
    snapshot: (windowId: number) => {
      const requests = [...pending.values()]
        .filter((request) => request.windowId === windowId)
        .map(
          ({
            windowId: _w,
            contents,
            answer: _a,
            timer: _t,
            desktopSources: _d,
            ...request
          }): BrowserMediaRequest => ({
            ...request,
            ...(request.kind === 'display'
              ? {
                  sources: [
                    ...host
                      .tabs()
                      .filter(
                        (tab) =>
                          !tab.contents.isDestroyed() && webOrigin(tab.contents.mainFrame.url),
                      )
                      .map((tab) => ({
                        key: tab.key,
                        title: tab.contents.getTitle().slice(0, 200),
                        url: tab.contents.getURL().slice(0, 2000),
                        requester: tab.contents.id === contents.id,
                        profileId: tab.profileId,
                        kind: 'tab' as const,
                        audioSupported: true,
                      })),
                    ...(remoteSources.get(windowId) ?? []).map((tab) => ({
                      key: tab.key,
                      title: tab.title,
                      url: tab.url,
                      profileId: tab.profileId,
                      kind: 'remote' as const,
                      requester: false,
                      audioSupported: false,
                    })),
                    ...(threadSources.get(windowId) ?? []).map((item) => ({
                      key: `thread:${item.runtimeId}:${item.taskId}`,
                      title: item.title,
                      url: '',
                      kind: 'thread' as const,
                      requester: false,
                      audioSupported: false,
                    })),
                    ...(_d ?? []).map((item) => ({
                      key: item.id,
                      title: item.name,
                      url: '',
                      kind: item.id.startsWith('screen:')
                        ? ('screen' as const)
                        : ('window' as const),
                      requester: false,
                      audioSupported: false,
                      thumbnail: item.thumbnail.toDataURL(),
                    })),
                  ],
                }
              : {}),
          }),
        )
      refresh()
      const active = [...captures.values()]
        .filter((capture) => capture.windowId === windowId)
        .map(
          ({
            windowId: _w,
            contents: _c,
            frame: _f,
            source,
            closeSource: _close,
            approvedAt: _a,
            seen: _seen,
            stopAt: _t,
            pageId: _p,
            unresponsive,
            ...capture
          }): BrowserCapture => ({
            ...capture,
            sourceTitle: capture.sourceTitle ?? source?.getTitle().slice(0, 200),
            sourceUrl: capture.sourceKind ? capture.sourceUrl : source?.getURL().slice(0, 2000),
            ...(unresponsive ? { unresponsive } : {}),
          }),
        )
      return {
        ...(requests.length ? { mediaRequests: requests } : {}),
        ...(active.length ? { captures: active } : {}),
      }
    },
    /** Hidden call pages and their sources must survive the inactive-view cache eviction. */
    keepAlive: (contents: Electron.WebContents) => {
      if (contents.isDestroyed()) return false
      refresh()
      return (
        contents.isCurrentlyAudible() ||
        contents.isBeingCaptured() ||
        grants.has(contents.id) ||
        [...pending.values()].some((request) => request.contents.id === contents.id) ||
        [...captures.values()].some(
          (capture) => capture.contents.id === contents.id || capture.source?.id === contents.id,
        )
      )
    },
    /** Browser was turned off: deny everything pending and forget camera/microphone answers. */
    reset: () => {
      for (const request of [...pending.values()]) settle(request, false)
      grants.clear()
      remoteSources.clear()
      threadSources.clear()
      for (const capture of captures.values()) capture.closeSource?.()
    },
  }
}
