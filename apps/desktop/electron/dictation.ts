import { app, ipcMain, session, systemPreferences } from 'electron'
import { join } from 'node:path'
import { DictationEngine } from './dictation-engine.js'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'

export function registerDictation(
  rendererPath: string,
  bundleDirectory: string,
  dataDirectory: string,
) {
  const engine = new DictationEngine(
    join(bundleDirectory, process.platform === 'win32' ? 'transcribe-cli.exe' : 'transcribe-cli'),
    join(dataDirectory, 'dictation'),
  )
  let active:
    | { sender: number; id: string; controller: AbortController; done: Promise<unknown> }
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
  ipcMain.handle('dictation:transcribe', (event, id: unknown, pcm: unknown) =>
    run(event, id, (signal) => {
      if (!(pcm instanceof ArrayBuffer)) throw new Error('Invalid dictation audio.')
      return engine.transcribe(pcm, signal)
    }),
  )
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
