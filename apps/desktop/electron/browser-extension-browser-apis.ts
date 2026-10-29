import { Schema } from 'effect'
import { dialog, type BrowserWindow } from 'electron'
import { createBrowserHistory } from './browser-history.js'
import { browserDownloads } from './browser-downloads.js'
import { createBrowserIdentity } from './browser-identity.js'

type Event = { extension: Pick<Electron.Extension, 'id' | 'name'> }
type Handler = (event: Event, ...args: unknown[]) => unknown
type Register = (name: string, callback: Handler, options?: { extensionContext: boolean }) => void
const internals = Schema.Struct({
  ctx: Schema.Struct({
    router: Schema.Struct({
      apiHandler: Schema.declare((v: unknown): v is () => Register => typeof v === 'function'),
      sendEvent: Schema.declare(
        (v: unknown): v is (id: string, name: string, ...args: unknown[]) => void =>
          typeof v === 'function',
      ),
    }),
  }),
  api: Schema.Struct({
    permissions: Schema.Struct({
      getAll: Schema.declare(
        (v: unknown): v is (event: Event) => { permissions?: string[] } | undefined =>
          typeof v === 'function',
      ),
    }),
  }),
})
const finite = Schema.Number.pipe(Schema.check(Schema.isFinite()))
const nonnegative = finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
const integer = nonnegative.pipe(Schema.check(Schema.isInt()))
const urlRequest = Schema.Struct({ url: Schema.String })
const historyQuery = Schema.Struct({
  text: Schema.String,
  startTime: Schema.optional(finite),
  endTime: Schema.optional(finite),
  maxResults: Schema.optional(integer),
})
const range = Schema.Struct({ startTime: finite, endTime: finite })
const downloadOptions = Schema.Struct({
  url: Schema.String,
  filename: Schema.optional(Schema.String),
  saveAs: Schema.optional(Schema.Boolean),
  conflictAction: Schema.optional(Schema.Literals(['uniquify', 'overwrite', 'prompt'])),
  headers: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
  ),
})
const downloadQuery = Schema.Struct({
  id: Schema.optional(integer),
  url: Schema.optional(Schema.String),
  filename: Schema.optional(Schema.String),
  state: Schema.optional(Schema.Literals(['in_progress', 'complete', 'interrupted'])),
  paused: Schema.optional(Schema.Boolean),
  danger: Schema.optional(Schema.String),
  exists: Schema.optional(Schema.Boolean),
  mime: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  totalBytes: Schema.optional(finite),
  bytesReceived: Schema.optional(nonnegative),
  query: Schema.optional(Schema.Array(Schema.String)),
  limit: Schema.optional(integer),
  orderBy: Schema.optional(Schema.Array(Schema.String)),
  startedAfter: Schema.optional(Schema.String),
  startedBefore: Schema.optional(Schema.String),
  endedAfter: Schema.optional(Schema.String),
  endedBefore: Schema.optional(Schema.String),
  totalBytesGreater: Schema.optional(finite),
  totalBytesLess: Schema.optional(finite),
  urlRegex: Schema.optional(Schema.String),
  filenameRegex: Schema.optional(Schema.String),
})
const authOptions = Schema.Struct({
  url: Schema.String,
  interactive: Schema.optional(Schema.Boolean),
  abortOnLoadForNonInteractive: Schema.optional(Schema.Boolean),
  timeoutMsForNonInteractive: Schema.optional(
    nonnegative.pipe(Schema.check(Schema.isLessThanOrEqualTo(60_000))),
  ),
})

/** Runtime-checked adapter for electron-chrome-extensions 4.10.0. */
export function attachExtensionBrowserAPIs(
  library: unknown,
  options: {
    session: Electron.Session
    profileId: string
    window: () => BrowserWindow | undefined
  },
) {
  if (!Schema.is(internals)(library))
    throw new Error('Extension browser APIs are unavailable in this build.')
  const { router } = library.ctx
  const allowed = (event: Event, permission: string) =>
    library.api.permissions.getAll(event)?.permissions?.includes(permission) === true
  const emit = (name: string, value: unknown) => {
    const permission = name.split('.')[0]!
    for (const extension of options.session.extensions.getAllExtensions())
      if (allowed({ extension }, permission)) router.sendEvent(extension.id, name, value)
  }
  const history = createBrowserHistory(options.profileId, emit)
  const downloads = browserDownloads(options.session, options.profileId)
  const unsubscribeDownloads = downloads.subscribe(emit)
  const identity = createBrowserIdentity(options.session)
  const handle = (name: string, callback: Handler, permission = name.split('.')[0]!) => {
    router.apiHandler()(
      name,
      (event, ...args) => {
        if (!allowed(event, permission))
          throw new Error(`${name} requires the ${permission} permission.`)
        return callback(event, ...args)
      },
      { extensionContext: true },
    )
  }
  const parse = Schema.decodeUnknownSync
  handle('history.search', (_event, raw) => history.search(parse(historyQuery)(raw)))
  handle('history.getVisits', (_event, raw) => history.visits(parse(urlRequest)(raw).url))
  handle('history.addUrl', (_event, raw) => history.add(parse(urlRequest)(raw).url, '', 'link'))
  handle('history.deleteUrl', (_event, raw) => history.remove(parse(urlRequest)(raw).url))
  handle('history.deleteRange', (_event, raw) => {
    const r = parse(range)(raw)
    if (r.endTime < r.startTime) throw new Error('Invalid history range.')
    history.removeRange(r.startTime, r.endTime)
  })
  handle('history.deleteAll', () => history.clear())
  handle('downloads.download', (event, raw) => {
    const request = parse(downloadOptions)(raw, { onExcessProperty: 'error' })
    for (const header of request.headers ?? [])
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name) ||
        /[\r\n]/.test(header.value) ||
        /^(host|content-length|cookie|origin|referer|proxy-.*|sec-.*)$/i.test(header.name)
      )
        throw new Error('Invalid download header.')
    return downloads.download(request, event.extension)
  })
  handle('downloads.search', (_event, raw) => downloads.search(parse(downloadQuery)(raw)))
  handle('downloads.erase', (_event, raw) => downloads.erase(parse(downloadQuery)(raw)))
  for (const method of ['pause', 'resume', 'cancel', 'removeFile', 'show'] as const)
    handle(`downloads.${method}`, (_event, id) => downloads[method](parse(integer)(id)))
  handle('downloads.getFileIcon', (_event, id, raw) => {
    const details = parse(Schema.Struct({ size: Schema.optional(Schema.Literals([16, 32])) }))(
      raw ?? {},
    )
    return downloads.icon(parse(integer)(id), details.size === 32 ? 'normal' : 'small')
  })
  handle('downloads.showDefaultFolder', () => downloads.showFolder())
  handle(
    'downloads.open',
    async (event, id) => {
      const value = parse(integer)(id)
      const item = downloads.search({ id: value })[0]
      if (!item || item.state !== 'complete' || !item.exists)
        throw new Error('Downloaded file is not available.')
      const settings: Electron.MessageBoxOptions = {
        type: 'question',
        title: 'Open downloaded file',
        message: `Open ${item.filename}?`,
        detail: 'This may launch another application.',
        buttons: ['Open', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      }
      const parent = options.window()
      const answer = await (parent
        ? dialog.showMessageBox(parent, settings)
        : dialog.showMessageBox(settings))
      if (answer.response !== 0) throw new Error('Opening the download was cancelled.')
      if (!allowed(event, 'downloads.open'))
        throw new Error('Download opening permission was removed.')
      return downloads.open(value)
    },
    'downloads.open',
  )
  handle('identity.launchWebAuthFlow', async (event, raw) => {
    const result = await identity.launch(event.extension.id, parse(authOptions)(raw))
    if (!allowed(event, 'identity')) throw new Error('Identity permission was removed.')
    return result
  })
  return {
    attachTab: (contents: Electron.WebContents) => history.attach(contents),
    removeTab: (contents: Electron.WebContents) => history.detach(contents),
    close: (id: string) => identity.close(id),
    dispose() {
      identity.dispose()
      history.dispose()
      unsubscribeDownloads()
    },
  }
}
