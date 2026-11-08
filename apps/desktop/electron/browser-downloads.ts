import { app, BrowserWindow, shell } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { isPrivateBrowserProfile } from '@dovo/protocol'

const itemSchema = Schema.Struct({
  id: Schema.Number,
  url: Schema.String,
  finalUrl: Schema.String,
  filename: Schema.String,
  mime: Schema.String,
  startTime: Schema.String,
  endTime: Schema.optional(Schema.String),
  state: Schema.Literals(['in_progress', 'complete', 'interrupted']),
  paused: Schema.Boolean,
  canResume: Schema.Boolean,
  danger: Schema.String,
  bytesReceived: Schema.Number,
  totalBytes: Schema.Number,
  fileSize: Schema.Number,
  exists: Schema.Boolean,
  error: Schema.optional(Schema.String),
  byExtensionId: Schema.optional(Schema.String),
  byExtensionName: Schema.optional(Schema.String),
  incognito: Schema.Boolean,
})
export type BrowserDownload = Schema.Schema.Type<typeof itemSchema>
export type DownloadOptions = {
  url: string
  filename?: string
  saveAs?: boolean
  conflictAction?: 'uniquify' | 'overwrite' | 'prompt'
  headers?: readonly { name: string; value: string }[]
}
export type DownloadQuery = Partial<
  Pick<
    BrowserDownload,
    | 'id'
    | 'url'
    | 'filename'
    | 'state'
    | 'paused'
    | 'danger'
    | 'exists'
    | 'mime'
    | 'totalBytes'
    | 'bytesReceived'
    | 'error'
  >
> & {
  query?: readonly string[]
  limit?: number
  orderBy?: readonly string[]
  startedAfter?: string
  startedBefore?: string
  endedAfter?: string
  endedBefore?: string
  totalBytesGreater?: number
  totalBytesLess?: number
  urlRegex?: string
  filenameRegex?: string
}
/** Chrome filenames are relative paths under Downloads, regardless of platform. */
export function downloadFilename(root: string, name: string) {
  if (
    !name ||
    isAbsolute(name) ||
    /^[a-z]:/i.test(name) ||
    name.includes('\\') ||
    name.split('').some((character) => character.charCodeAt(0) < 32) ||
    name.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid download filename.')
  const path = resolve(root, name)
  if (!path.startsWith(resolve(root) + sep)) throw new Error('Invalid download filename.')
  if (existsSync(root)) {
    const realRoot = realpathSync(root)
    let ancestor = path
    while (!existsSync(ancestor)) ancestor = dirname(ancestor)
    const actual = realpathSync(ancestor)
    if (actual !== realRoot && !actual.startsWith(realRoot + sep))
      throw new Error('Download filename escapes the Downloads folder.')
  }
  return path
}
// Every profile writes to the same Downloads folder. Keep reservations until the
// native item finishes, even when its profile tracker has been disposed.
const pendingDownloadPaths = new Map<Electron.DownloadItem, string>()
const destinationKey = (path: string) => {
  let ancestor = resolve(path)
  const missing: string[] = []
  while (!existsSync(ancestor)) {
    missing.unshift(basename(ancestor))
    ancestor = dirname(ancestor)
  }
  const canonical = join(realpathSync(ancestor), ...missing)
  // Conservative folding also protects the usual case-insensitive macOS volumes.
  return process.platform === 'linux' ? canonical : canonical.toLowerCase()
}
export function createBrowserDownloads(
  session: Electron.Session,
  profileId: string,
  emit: (event: string, value: unknown) => void,
) {
  const storeSchema = Schema.Struct({ nextId: Schema.Number, items: Schema.Array(itemSchema) })
  const directory = join(app.getPath('userData'), 'browser-downloads')
  const path = join(directory, `${profileId}.json`)
  const privateProfile = isPrivateBrowserProfile(profileId)
  let stored: { nextId: number; items: readonly BrowserDownload[] } = { nextId: 1, items: [] }
  if (!privateProfile) {
    try {
      stored = Schema.decodeUnknownSync(storeSchema)(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw new Error('Browser download history could not be read.')
    }
  }
  const records = new Map<number, BrowserDownload>(
    stored.items.map((item) => [
      item.id,
      item.state === 'in_progress'
        ? { ...item, state: 'interrupted' as const, error: 'CRASH', canResume: false }
        : item,
    ]),
  )
  let nextId = Math.max(stored.nextId, Math.max(0, ...records.keys()) + 1)
  const live = new Map<number, Electron.DownloadItem>()
  const requests = new Map<
    Electron.WebContents,
    {
      options: DownloadOptions
      extension?: { id: string; name: string }
      resolve: (id: number) => void
      reject: (error: Error) => void
      close: () => void
    }
  >()
  const persist = () => {
    if (privateProfile) return
    mkdirSync(directory, { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(
      temporary,
      JSON.stringify({ nextId, items: [...records.values()].slice(-10_000) }),
      { mode: 0o600 },
    )
    renameSync(temporary, path)
  }
  const save = () => {
    try {
      persist()
    } catch (error) {
      console.error('Could not save browser downloads.', error)
    }
  }
  const get = (id: number) => {
    const item = records.get(id)
    if (!item) throw new Error('Invalid download ID.')
    return item
  }
  const active = (id: number) => {
    get(id)
    const item = live.get(id)
    if (!item) throw new Error('Download is no longer active.')
    return item
  }
  const change = (id: number, next: BrowserDownload) => {
    const previous = get(id)
    records.set(id, next)
    const delta: Record<string, unknown> = { id }
    for (const key of Object.keys(next)) {
      const current = Reflect.get(next, key),
        old = Reflect.get(previous, key)
      if (current !== old) delta[key] = { previous: old, current }
    }
    if (Object.keys(delta).length > 1) emit('downloads.onChanged', delta)
  }
  const willDownload = (
    _event: Electron.Event,
    item: Electron.DownloadItem,
    contents: Electron.WebContents,
  ) => {
    const request = requests.get(contents)
    const options = request?.options
    const root = app.getPath('downloads')
    item.once('done', () => pendingDownloadPaths.delete(item))
    try {
      // Native save UI remains the default for ordinary website downloads.
      if (options) {
        let destination = downloadFilename(root, options.filename ?? basename(item.getFilename()))
        const conflict = options.conflictAction ?? 'uniquify'
        if (conflict === 'uniquify') {
          const extension = extname(destination),
            stem = destination.slice(0, destination.length - extension.length)
          for (
            let n = 1;
            existsSync(destination) ||
            [...pendingDownloadPaths.values()].includes(destinationKey(destination));
            n++
          )
            destination = `${stem} (${n})${extension}`
        }
        if (options.saveAs || conflict === 'prompt')
          item.setSaveDialogOptions({ defaultPath: destination })
        else {
          pendingDownloadPaths.set(item, destinationKey(destination))
          item.setSavePath(destination)
        }
      }
      const id = nextId++
      const record: BrowserDownload = {
        id,
        url: item.getURL(),
        finalUrl: item.getURLChain().at(-1) ?? item.getURL(),
        filename: item.getSavePath(),
        mime: item.getMimeType(),
        startTime: new Date(item.getStartTime() * 1000).toISOString(),
        state: 'in_progress',
        paused: item.isPaused(),
        canResume: item.canResume(),
        danger: 'safe',
        bytesReceived: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        fileSize: -1,
        exists: false,
        incognito: privateProfile,
        ...(request?.extension
          ? { byExtensionId: request.extension.id, byExtensionName: request.extension.name }
          : {}),
      }
      records.set(id, record)
      live.set(id, item)
      save()
      emit('downloads.onCreated', record)
      item.on('updated', () => {
        const path = item.getSavePath()
        if (path) pendingDownloadPaths.set(item, destinationKey(path))
        const current = records.get(id)
        if (!current) return
        change(id, {
          ...current,
          filename: item.getSavePath(),
          finalUrl: item.getURLChain().at(-1) ?? item.getURL(),
          paused: item.isPaused(),
          canResume: item.canResume(),
          bytesReceived: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
        })
      })
      item.once('done', (_event, state) => {
        const current = records.get(id)
        if (current)
          change(id, {
            ...current,
            filename: item.getSavePath(),
            endTime: new Date().toISOString(),
            state: state === 'completed' ? 'complete' : 'interrupted',
            error:
              state === 'completed'
                ? undefined
                : state === 'cancelled'
                  ? 'USER_CANCELED'
                  : 'NETWORK_FAILED',
            bytesReceived: item.getReceivedBytes(),
            fileSize: state === 'completed' ? item.getReceivedBytes() : -1,
            exists: existsSync(item.getSavePath()),
            paused: false,
            canResume: false,
          })
        live.delete(id)
        save()
      })
      if (request) {
        requests.delete(contents)
        request.resolve(id)
        request.close()
      }
    } catch (error) {
      let failure = error instanceof Error ? error : new Error('Download could not start.')
      try {
        item.cancel()
      } catch (cause) {
        failure = new AggregateError([failure, cause], 'Download setup and cancellation failed.')
      }
      // Once native ownership exists, only done may release the destination.
      if (!item.getSavePath()) pendingDownloadPaths.delete(item)
      if (request) {
        requests.delete(contents)
        request.reject(failure)
        request.close()
      } else console.error('Could not start browser download.', failure)
    }
  }
  session.on('will-download', willDownload)
  const search = (query: DownloadQuery) => {
    const urlRegex = query.urlRegex === undefined ? undefined : new RegExp(query.urlRegex)
    const filenameRegex =
      query.filenameRegex === undefined ? undefined : new RegExp(query.filenameRegex)
    let result = [...records.values()]
      .map((item) => ({ ...item, exists: existsSync(item.filename) }))
      .filter((item) => {
        for (const field of [
          'id',
          'url',
          'filename',
          'state',
          'paused',
          'danger',
          'exists',
          'mime',
          'totalBytes',
          'bytesReceived',
          'error',
        ] as const)
          if (query[field] !== undefined && query[field] !== item[field]) return false
        if (
          (query.totalBytesGreater !== undefined && item.totalBytes <= query.totalBytesGreater) ||
          (query.totalBytesLess !== undefined && item.totalBytes >= query.totalBytesLess)
        )
          return false
        if (
          (query.startedAfter && item.startTime <= query.startedAfter) ||
          (query.startedBefore && item.startTime >= query.startedBefore) ||
          (query.endedAfter && (!item.endTime || item.endTime <= query.endedAfter)) ||
          (query.endedBefore && (!item.endTime || item.endTime >= query.endedBefore))
        )
          return false
        if (
          (urlRegex && !urlRegex.test(item.url)) ||
          (filenameRegex && !filenameRegex.test(item.filename))
        )
          return false
        const text = `${item.url}\n${item.filename}`.toLowerCase()
        return (query.query ?? []).every((term) =>
          term.startsWith('-')
            ? !text.includes(term.slice(1).toLowerCase())
            : text.includes(term.toLowerCase()),
        )
      })
    const order = query.orderBy ?? ['-startTime']
    result.sort((a, b) => {
      for (const field of order) {
        const key = field.replace(/^-/, ''),
          av: unknown = Reflect.get(a, key),
          bv: unknown = Reflect.get(b, key)
        if (av === bv) continue
        const n =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv))
        return field.startsWith('-') ? -n : n
      }
      return 0
    })
    if (query.limit !== 0) result = result.slice(0, query.limit ?? 1000)
    return result
  }
  return {
    search,
    download(options: DownloadOptions, extension?: { id: string; name: string }) {
      const url = new URL(options.url)
      if (
        !['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error('Unsupported download URL.')
      if (options.filename) downloadFilename(app.getPath('downloads'), options.filename)
      // A unique contents instance correlates concurrent requests without matching URLs.
      const window = new BrowserWindow({
        show: false,
        webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          requests.delete(window.webContents)
          window.destroy()
          reject(new Error('Download did not start.'))
        }, 30_000)
        const close = () => {
          clearTimeout(timer)
          setImmediate(() => {
            if (!window.isDestroyed()) window.destroy()
          })
        }
        requests.set(window.webContents, { options, extension, resolve, reject, close })
        try {
          window.webContents.downloadURL(options.url, {
            headers: Object.fromEntries(
              (options.headers ?? []).map((header) => [header.name, header.value]),
            ),
          })
        } catch (error) {
          requests.delete(window.webContents)
          close()
          reject(error)
        }
      })
    },
    pause(id: number) {
      active(id).pause()
    },
    resume(id: number) {
      const item = active(id)
      if (!item.canResume()) throw new Error('Download cannot be resumed.')
      item.resume()
    },
    cancel(id: number) {
      active(id).cancel()
    },
    erase(query: DownloadQuery) {
      const ids = search({ ...query, limit: query.limit ?? 0 })
        .filter((item) => !live.has(item.id))
        .map((item) => item.id)
      for (const id of ids) {
        records.delete(id)
        emit('downloads.onErased', id)
      }
      persist()
      return ids
    },
    removeFile(id: number) {
      const item = get(id)
      if (item.state !== 'complete') throw new Error('Download is not complete.')
      unlinkSync(item.filename)
      change(id, { ...item, exists: false })
      persist()
    },
    show(id: number) {
      const item = get(id)
      if (!existsSync(item.filename)) throw new Error('Downloaded file does not exist.')
      shell.showItemInFolder(item.filename)
    },
    async open(id: number) {
      const item = get(id)
      if (item.state !== 'complete') throw new Error('Download is not complete.')
      const error = await shell.openPath(item.filename)
      if (error) throw new Error(error)
    },
    async icon(id: number, size: 'small' | 'normal' | 'large' = 'small') {
      return (await app.getFileIcon(get(id).filename, { size })).toDataURL()
    },
    async showFolder() {
      const error = await shell.openPath(app.getPath('downloads'))
      if (error) throw new Error(error)
    },
    dispose() {
      session.off('will-download', willDownload)
      for (const request of requests.values()) {
        request.reject(new Error('Browser profile closed.'))
        request.close()
      }
      requests.clear()
      save()
    },
  }
}

// One authoritative tracker per session, shared by native chrome and extension APIs.
const trackers = new Map<
  Electron.Session,
  {
    downloads: ReturnType<typeof createBrowserDownloads>
    listeners: Set<(event: string, value: unknown) => void>
  }
>()
export function browserDownloads(session: Electron.Session, profileId: string) {
  let tracker = trackers.get(session)
  if (!tracker) {
    const listeners = new Set<(event: string, value: unknown) => void>()
    const downloads = createBrowserDownloads(session, profileId, (event, value) => {
      for (const listener of listeners) listener(event, value)
    })
    tracker = { downloads, listeners }
    trackers.set(session, tracker)
  }
  const { downloads, listeners } = tracker
  return {
    ...downloads,
    subscribe(listener: (event: string, value: unknown) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
export function disposeBrowserDownloads(session: Electron.Session) {
  trackers.get(session)?.downloads.dispose()
  trackers.delete(session)
}
