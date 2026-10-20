import { app, ipcMain, session, systemPreferences } from 'electron'
import { join } from 'node:path'
import { DictationEngine, type DictationSession } from './dictation-engine.js'
import { decode, dictationLanguageSchema, type DictationUpdate } from '@dovo/protocol'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'

export function registerDictation(
  rendererPath: string,
  bundleDirectory: string,
  dataDirectory: string,
) {
  const engine = new DictationEngine(
    join(bundleDirectory, process.platform === 'win32' ? 'dovo-dictation.exe' : 'dovo-dictation'),
    join(dataDirectory, 'dictation'),
  )
  let active:
    | {
        sender: number
        id: string
        controller: AbortController
        done: Promise<unknown>
        session?: DictationSession
      }
    | undefined
  const checkId = (id: unknown): string => {
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id))
      throw new Error('Invalid dictation session.')
    return id
  }
  const run = async (
    event: Electron.IpcMainInvokeEvent,
    id: unknown,
    work: (signal: AbortSignal) => Promise<unknown>,
  ) => {
    requireTrustedRenderer(event, rendererPath)
    const key = checkId(id)
    if (active) throw new Error('Another dictation session is still running.')
    const controller = new AbortController()
    // Reserve before the first asynchronous operation, including on another window.
    const operation = {
      sender: event.sender.id,
      id: key,
      controller,
      done: Promise.resolve<unknown>(undefined),
    }
    active = operation
    const abort = () => controller.abort()
    event.sender.once('destroyed', abort)
    event.sender.on('did-start-navigation', abort)
    try {
      operation.done = work(controller.signal)
      return await operation.done
    } finally {
      event.sender.removeListener('destroyed', abort)
      event.sender.removeListener('did-start-navigation', abort)
      if (active === operation) active = undefined
    }
  }
  ipcMain.handle('dictation:status', (event) => {
    requireTrustedRenderer(event, rendererPath)
    return engine.status()
  })
  ipcMain.handle('dictation:install', (event, id: unknown) =>
    run(event, id, (signal) => engine.install(signal)),
  )
  ipcMain.handle('dictation:start', (event, id: unknown, language: unknown) => {
    let resolveReady: () => void, rejectReady: (error: unknown) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const update = (value: DictationUpdate) => {
      if (!event.sender.isDestroyed()) event.sender.send('dictation:update', id, value)
    }
    void run(event, id, async (signal) => {
      const locale = decode(dictationLanguageSchema, language)
      const session = await engine.start(locale, signal, (text) => update({ type: 'text', text }))
      if (!active || signal.aborted) throw new Error('Dictation was cancelled.')
      active.session = session
      resolveReady()
      try {
        await session.done
      } catch (cause) {
        if (!signal.aborted)
          update({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })
        throw cause
      }
    }).catch((cause: unknown) => rejectReady(cause))
    return ready
  })
  const ownedSession = (event: Electron.IpcMainInvokeEvent, id: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    const key = checkId(id)
    if (active?.sender !== event.sender.id || active.id !== key || !active.session)
      throw new Error('This dictation session is no longer active.')
    return active.session
  }
  ipcMain.handle('dictation:feed', (event, id: unknown, pcm: unknown) => {
    const session = ownedSession(event, id)
    if (!(pcm instanceof ArrayBuffer)) throw new Error('Invalid dictation audio.')
    return session.feed(pcm)
  })
  ipcMain.handle('dictation:finish', (event, id: unknown) => ownedSession(event, id).finish())
  ipcMain.handle('dictation:cancel', async (event, id: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    const key = checkId(id)
    if (active?.sender === event.sender.id && active.id === key) {
      const operation = active
      operation.controller.abort()
      await operation.done.catch(() => undefined) // Cancellation is expected; owner receives any failure.
    }
  })
  void app.whenReady().then(() => {
    const trusted = (contents: Electron.WebContents | null) =>
      !!contents &&
      trustedRendererUrl(contents.getURL(), rendererPath, process.env.VITE_DEV_SERVER_URL)
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        // Preserve Electron's existing defaults for unrelated permissions (e.g. clipboard copy).
        permission !== 'media' ||
        (details.mediaType === 'audio' &&
          details.isMainFrame &&
          !!details.requestingUrl &&
          trustedRendererUrl(
            details.requestingUrl,
            rendererPath,
            process.env.VITE_DEV_SERVER_URL,
          ) &&
          trusted(contents)),
    )
    session.defaultSession.setPermissionRequestHandler((contents, permission, respond, details) => {
      if (permission !== 'media') return respond(true)
      if (
        !trusted(contents) ||
        !details.isMainFrame ||
        !trustedRendererUrl(details.requestingUrl, rendererPath, process.env.VITE_DEV_SERVER_URL) ||
        permission !== 'media' ||
        !('mediaTypes' in details) ||
        !details.mediaTypes?.length ||
        details.mediaTypes.some((type) => type !== 'audio')
      )
        return respond(false)
      if (process.platform !== 'darwin') return respond(true)
      void systemPreferences.askForMediaAccess('microphone').then(respond, () => respond(false))
    })
  })
  return { dispose: () => active?.controller.abort() }
}
