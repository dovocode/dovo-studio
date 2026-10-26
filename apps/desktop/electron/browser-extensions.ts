import { readLocalSettingsSection } from '@dovo/protocol/local-settings'
import {
  browserExtensionCommandSchema,
  decode,
  decodeResult,
  mutableArray,
  mutableStruct,
  type BrowserExtension,
  type BrowserExtensionsResult,
} from '@dovo/protocol'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import crxPreload from 'electron-chrome-extensions/preload?raw'
import { app, BrowserWindow, dialog, session, type BaseWindow } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { chromeStoreId, downloadStoreExtension, unpackStoreExtension } from './browser-web-store.js'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { Schema } from 'effect'
import { attachNativeMessaging } from './browser-native-messaging.js'

/** Shared-browser profiles never share storage with agent-enabled thread previews. */
export const workspacePartition = (profileId: string) =>
  `persist:dovo-browser-workspace:${profileId}`

const PROFILE = /^[a-zA-Z0-9_-]{1,100}$/
const EXTENSION = /^[a-p]{32}$/
const DIRECTORY = /^[0-9a-f-]{36}$/
const MAX_ENTRIES = 10_000
const MAX_BYTES = 256 * 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_ICON_BYTES = 256 * 1024
/** Chrome match patterns for web pages only; `file:` and other schemes are never granted. */
const MATCH_PATTERN = /^(?:<all_urls>|(?:\*|https?):\/\/(?:\*|(?:\*\.)?[^/*:]+)(?::\d{1,5})?\/.*)$/
/** Provided by Electron or electron-chrome-extensions 4.10.0; everything else is reported. */
const SUPPORTED_PERMISSIONS = new Set([
  'activeTab',
  'commands',
  'contextMenus',
  'cookies',
  'management',
  'notifications',
  'nativeMessaging',
  'offscreen',
  'scripting',
  'storage',
  'tabs',
  'unlimitedStorage',
  'webNavigation',
  'webRequest',
])
const CAPABILITIES = {
  unpackedFolders: true,
  nativeMessaging: true,
  chromeWebStore: true,
  remoteRuntimes: false,
} as const
/**
 * Chromium's native `browser` namespace lacks the APIs electron-chrome-extensions adds to
 * `chrome`. Extensions such as 1Password read `browser.windows`, so point it at `chrome`.
 */
const ALIAS_PRELOAD = `const { contextBridge } = require('electron')
if (process.type === 'service-worker' || location.href.startsWith('chrome-extension://'))
  contextBridge.executeInMainWorld({
    func: () => {
      if (globalThis.chrome && globalThis.browser !== globalThis.chrome)
        Object.defineProperty(globalThis, 'browser', {
          value: globalThis.chrome,
          configurable: true,
          writable: true,
        })
    },
  })
`
const registrySchema = mutableStruct({
  version: Schema.Literal(1),
  extensions: mutableArray(
    mutableStruct({
      id: Schema.String.pipe(Schema.check(Schema.isPattern(EXTENSION))),
      directory: Schema.String.pipe(Schema.check(Schema.isPattern(DIRECTORY))),
      enabled: Schema.Boolean,
      removedPermissions: mutableArray(Schema.String),
    }),
  ),
})
type Registry = Schema.Schema.Type<typeof registrySchema>
type Installed = Registry['extensions'][number]
type Profile = {
  id: string
  session: Electron.Session
  extensions: ElectronChromeExtensions
  registry: Registry
  errors: Map<string, string>
  queue: Promise<unknown>
  native: ReturnType<typeof attachNativeMessaging>
  helperApprovals: Set<string>
}
type ActionClick = (details: {
  eventType: 'click'
  extensionId: string
  tabId: number
  anchorRect: { x: number; y: number; width: number; height: number }
}) => void
/** The only library version whose internals `clickAction` was checked against. */
export const ACTION_LIBRARY_VERSION = '4.10.0'
/**
 * electron-chrome-extensions has no main-process API for clicking an action. Its documented
 * `<browser-action-list>` element would run library code in the Studio renderer and reach the
 * same `browserAction.activateClick` over IPC. Call that internal through a runtime-checked shape
 * instead; tests pin the installed version and signature, so an upgrade fails until re-verified.
 */
const actionInternals = Schema.Struct({
  api: Schema.Struct({
    browserAction: Schema.Struct({
      activateClick: Schema.declare(
        (value: unknown): value is ActionClick => typeof value === 'function',
      ),
    }),
  }),
})
const hasActionInternals = Schema.is(actionInternals)
const popupInternals = Schema.Struct({
  browserWindow: Schema.declare(
    (value: unknown): value is BrowserWindow => value instanceof BrowserWindow,
  ),
  parent: Schema.declare(
    (value: unknown): value is BrowserWindow => value instanceof BrowserWindow,
  ),
})
function clickAction(library: unknown, details: Parameters<ActionClick>[0]) {
  if (!hasActionInternals(library))
    throw new Error('Extension popups are unavailable in this build.')
  library.api.browserAction.activateClick(details)
}
export type ExtensionTabHost = {
  /** Open a hidden shared-browser tab for an extension; the renderer adopts it by key. */
  create(
    profileId: string,
    details: { url?: string; active?: boolean; windowId?: number },
  ): Promise<[Electron.WebContents, BaseWindow]>
  /** Close a tab because its extension called `chrome.tabs.remove`. */
  close(contents: Electron.WebContents): void
  /** Resolve the renderer's tab key to its native page in that profile. */
  find(window: BrowserWindow, key: string, profileId: string): Electron.WebContents | undefined
  /** The Studio window showing this profile, to parent permission prompts. */
  window(profileId: string): BrowserWindow | undefined
}

const enabled = () => {
  const settings = readLocalSettingsSection('app')
  return (
    !!settings &&
    typeof settings === 'object' &&
    'browserWorkspaceEnabled' in settings &&
    settings.browserWorkspaceEnabled === true
  )
}
const requireEnabled = () => {
  if (!enabled())
    throw new Error('Enable experimental Browser in Settings → General before adding extensions.')
}
const profileName = (id: string) => {
  const settings = readLocalSettingsSection('app')
  const schema = Schema.Struct({
    browserProfiles: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  })
  return (
    (Schema.is(schema)(settings)
      ? settings.browserProfiles.find((profile) => profile.id === id)?.name
      : undefined) ?? (id === 'default' ? 'Default' : 'Unavailable profile')
  )
}
const inside = (root: string, path: string) => {
  const target = resolve(root, path)
  return target.startsWith(root + sep) ? target : undefined
}
/** Chromium derives a packed extension's ID from its public key. */
const keyId = (key: string) =>
  createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .split('')
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join('')
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/** Copy only regular files and folders; symbolic links could reach outside the chosen folder. */
async function copyTree(
  source: string,
  target: string,
  budget: { entries: number; bytes: number },
) {
  await mkdir(target)
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (++budget.entries > MAX_ENTRIES) throw new Error('This extension has too many files.')
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) await copyTree(from, to, budget)
    else if (entry.isFile()) {
      budget.bytes += (await lstat(from)).size
      if (budget.bytes > MAX_BYTES) throw new Error('This extension is larger than 256 MB.')
      await copyFile(from, to)
    } else throw new Error('Extension folders can only contain regular files and folders.')
  }
}
async function readManifest(directory: string) {
  const path = join(directory, 'manifest.json')
  const info = await lstat(path).catch(() => undefined)
  if (!info?.isFile() || info.size > MAX_MANIFEST_BYTES)
    throw new Error('Choose an unpacked extension folder that contains a manifest.json file.')
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error('The extension manifest.json is not valid JSON.')
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new Error('The extension manifest.json is not valid.')
  const fields: { [key: string]: unknown } = Object.fromEntries(Object.entries(manifest))
  return fields
}
async function readIcon(directory: string, manifest: { [key: string]: unknown }) {
  const action: unknown = manifest.action
  const icons = [
    action && typeof action === 'object' ? Reflect.get(action, 'default_icon') : undefined,
    manifest.icons,
  ].flatMap((value) =>
    typeof value === 'string'
      ? [[32, value] as const]
      : value && typeof value === 'object'
        ? Object.entries(value).flatMap(([size, path]) =>
            typeof path === 'string' ? [[Number(size) || 0, path] as const] : [],
          )
        : [],
  )
  // Prefer the smallest icon that still looks sharp at toolbar size.
  icons.sort(([a], [b]) => (a >= 32 ? a : 1000 + a) - (b >= 32 ? b : 1000 + b))
  for (const [, path] of icons) {
    const file = inside(directory, path)
    if (!file || extname(file).toLowerCase() !== '.png') continue
    const info = await lstat(file).catch(() => undefined)
    if (!info?.isFile() || info.size > MAX_ICON_BYTES) continue
    return `data:image/png;base64,${(await readFile(file)).toString('base64')}`
  }
}

/** Resolve `__MSG_name__` from the default locale so the review names the real extension. */
async function displayName(directory: string, manifest: { [key: string]: unknown }) {
  const name = typeof manifest.name === 'string' ? manifest.name : 'this extension'
  const key = /^__MSG_(\w+)__$/.exec(name)?.[1]
  const locale = typeof manifest.default_locale === 'string' ? manifest.default_locale : ''
  if (!key || !/^[\w-]{1,20}$/.test(locale)) return name
  try {
    const path = join(directory, '_locales', locale, 'messages.json')
    const info = await lstat(path)
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) return name
    const messages: unknown = JSON.parse(await readFile(path, 'utf8'))
    const entry =
      messages && typeof messages === 'object'
        ? Object.entries(messages).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]
        : undefined
    return entry &&
      typeof entry === 'object' &&
      'message' in entry &&
      typeof entry.message === 'string'
      ? entry.message
      : name
  } catch {
    return name
  }
}

export function createBrowserExtensions(tabs: ExtensionTabHost) {
  const root = join(app.getPath('userData'), 'browser-extensions')
  const runtime = join(root, 'runtime')
  const profiles = new Map<string, Promise<Profile>>()
  /** Profiles whose extensions are loaded; tab hooks run synchronously against these only. */
  const ready = new Map<string, Profile>()
  let preloads: Promise<string> | undefined
  const profileRoot = (profileId: string) => join(root, 'profiles', profileId)
  const installed = (profileId: string, directory: string) =>
    join(profileRoot(profileId), 'installed', directory)

  /** The library resolves its preload from `modulePath/dist`; Vite inlines it into main.js. */
  const writePreloads = () =>
    (preloads ??= (async () => {
      await mkdir(join(runtime, 'dist'), { recursive: true })
      await writeFile(join(runtime, 'dist', 'chrome-extension-api.preload.js'), crxPreload)
      const alias = join(runtime, 'browser-alias.preload.js')
      await writeFile(alias, ALIAS_PRELOAD)
      return alias
    })().catch((error: unknown) => {
      preloads = undefined
      throw error
    }))
  const readRegistry = async (profileId: string): Promise<Registry> => {
    const raw = await readFile(join(profileRoot(profileId), 'registry.json'), 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      },
    )
    if (raw === undefined) return { version: 1, extensions: [] }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('The browser extension list for this profile is damaged.')
    }
    const result = decodeResult(registrySchema, parsed)
    if (!result.success) throw new Error('The browser extension list for this profile is damaged.')
    return result.data
  }
  /** Persist first, then adopt `next`; callers change running extensions only after this. */
  const saveRegistry = async (profile: Profile, next: Registry) => {
    const path = join(profileRoot(profile.id), 'registry.json')
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(next, null, 2))
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      console.error('Browser extension list could not be saved.', error)
      throw new Error('Dovo could not save the extension list, so nothing changed.')
    }
    profile.registry = next
  }
  const withRecords = (records: Installed[]): Registry => ({ version: 1, extensions: records })
  const load = async (profile: Profile, record: Installed) => {
    profile.errors.delete(record.id)
    try {
      const extension = await profile.session.extensions.loadExtension(
        installed(profile.id, record.directory),
      )
      if (extension.id !== record.id) {
        profile.session.extensions.removeExtension(extension.id)
        throw new Error('The managed extension copy changed its identity.')
      }
      // Browser may have been turned off while Electron was loading it.
      if (!enabled()) profile.session.extensions.removeExtension(extension.id)
    } catch (error) {
      profile.errors.set(
        record.id,
        error instanceof Error ? error.message.slice(0, 500) : 'The extension could not load.',
      )
    }
  }
  const unload = (profile: Profile, id: string) => {
    profile.native.close(id)
    for (const key of profile.helperApprovals)
      if (key.startsWith(`${id}:`)) profile.helperApprovals.delete(key)
    if (profile.session.extensions.getExtension(id)) profile.session.extensions.removeExtension(id)
  }

  const open = (profileId: string) => {
    if (!PROFILE.test(profileId)) throw new Error('Invalid browser profile.')
    let pending = profiles.get(profileId)
    if (!pending) {
      pending = (async () => {
        const alias = await writePreloads()
        await mkdir(join(profileRoot(profileId), 'installed'), { recursive: true })
        const registry = await readRegistry(profileId)
        const browserSession = session.fromPartition(workspacePartition(profileId))
        const extensions = new ElectronChromeExtensions({
          session: browserSession,
          modulePath: runtime,
          createTab: (details) => tabs.create(profileId, details),
          removeTab: (contents) => tabs.close(contents),
          createWindow: async () => {
            throw new Error('Dovo does not support extension windows yet.')
          },
          requestPermissions: (extension, request) =>
            requestPermissions(profileId, extension, request),
        })
        // The library's native child window is the overlay: keep it anchored and within Studio.
        extensions.on('browser-action-popup-created', (raw: unknown) => {
          if (!Schema.is(popupInternals)(raw)) return
          const popup = raw.browserWindow
          const parent = raw.parent
          const fit = () => {
            if (popup.isDestroyed() || parent.isDestroyed()) return
            const area = parent.getContentBounds()
            const bounds = popup.getBounds()
            const width = Math.min(bounds.width, area.width - 16)
            const height = Math.min(bounds.height, area.height - 16)
            const next = {
              width,
              height,
              x: Math.max(area.x + 8, Math.min(bounds.x, area.x + area.width - width - 8)),
              y: Math.max(area.y + 8, Math.min(bounds.y, area.y + area.height - height - 8)),
            }
            if (
              Object.keys(next).some((key) => Reflect.get(next, key) !== Reflect.get(bounds, key))
            )
              popup.setBounds(next)
          }
          popup.setHasShadow(true)
          popup.on('show', fit)
          popup.on('resize', fit)
          parent.on('resize', fit)
          popup.once('closed', () => parent.off('resize', fit))
        })
        for (const type of ['frame', 'service-worker'] as const)
          browserSession.registerPreloadScript({
            id: `dovo-browser-alias-${type}`,
            type,
            filePath: alias,
          })
        const helperApprovals = new Set<string>()
        const native = attachNativeMessaging(extensions, {
          session: browserSession,
          enabled,
          allow: async (extension, host, executable) => {
            const key = `${extension.id}:${host}:${executable}`
            if (helperApprovals.has(key)) return true
            const options: Electron.MessageBoxOptions = {
              type: 'warning',
              title: 'Connect desktop application',
              message: `Allow “${extension.name}” to connect to a desktop app?`,
              detail: `Desktop helper: ${host}\nExecutable: ${executable}\nBrowser profile: ${profileName(profileId)}\n\nThe extension can exchange data with this installed application. Your desktop app may also ask you to trust Dovo Studio.`,
              buttons: ['Connect', 'Cancel'],
              defaultId: 1,
              cancelId: 1,
              noLink: true,
            }
            const parent = tabs.window(profileId)
            const { response } = await (parent
              ? dialog.showMessageBox(parent, options)
              : dialog.showMessageBox(options))
            if (
              response !== 0 ||
              !enabled() ||
              browserSession.extensions.getExtension(extension.id)?.path !== extension.path
            )
              return false
            helperApprovals.add(key)
            return true
          },
        })
        const profile: Profile = {
          native,
          helperApprovals,
          id: profileId,
          session: browserSession,
          extensions,
          registry,
          errors: new Map(),
          queue: Promise.resolve(),
        }
        if (enabled())
          for (const record of registry.extensions) if (record.enabled) await load(profile, record)
        ready.set(profileId, profile)
        return profile
      })()
      profiles.set(profileId, pending)
      pending.catch(() => {
        if (profiles.get(profileId) === pending) profiles.delete(profileId)
      })
    }
    return pending
  }
  /** Every profile that finished or is still opening; failed opens are skipped. */
  const opened = async () =>
    (await Promise.all([...profiles.values()].map((p) => p.catch(() => undefined)))).filter(
      (profile) => profile !== undefined,
    )
  const unloadAll = (profile: Profile) => {
    for (const extension of profile.session.extensions.getAllExtensions())
      unload(profile, extension.id)
    profile.errors.clear()
  }
  /** Serialize changes per profile so installs, removals and toggles never interleave. */
  const change = async <T>(profile: Profile, work: () => Promise<T>) => {
    const next = profile.queue.then(work, work)
    profile.queue = next.catch(() => undefined)
    return next
  }
  const describe = async (profile: Profile, record: Installed): Promise<BrowserExtension> => {
    const directory = installed(profile.id, record.directory)
    const loaded = profile.session.extensions.getExtension(record.id)
    const manifest = await readManifest(directory).catch(() => undefined)
    const action: unknown = manifest?.action
    const actionField = (name: string): unknown =>
      action && typeof action === 'object' ? Reflect.get(action, name) : undefined
    const defaultTitle = actionField('default_title')
    const defaultPopup = actionField('default_popup')
    const icon = manifest && (await readIcon(directory, manifest).catch(() => undefined))
    const title = typeof defaultTitle === 'string' ? defaultTitle : undefined
    const name = loaded?.name ?? (typeof manifest?.name === 'string' ? manifest.name : record.id)
    const version =
      loaded?.version ?? (typeof manifest?.version === 'string' ? manifest.version : '')
    const error =
      profile.errors.get(record.id) ??
      (manifest ? undefined : 'The managed extension copy is missing or damaged.')
    return {
      id: record.id,
      name: name.slice(0, 200),
      version: version.slice(0, 50),
      enabled: record.enabled,
      loaded: !!loaded,
      ...(title ? { title: title.slice(0, 200) } : {}),
      ...(icon ? { icon } : {}),
      popup: typeof defaultPopup === 'string' && defaultPopup !== '',
      unsupportedPermissions: strings(manifest?.permissions)
        .filter((permission) => !SUPPORTED_PERMISSIONS.has(permission))
        .slice(0, 50),
      removedPermissions: record.removedPermissions,
      ...(error ? { error } : {}),
    }
  }
  const result = async (profile: Profile, installedId?: string) => ({
    extensions: await Promise.all(profile.registry.extensions.map((r) => describe(profile, r))),
    ...(installedId ? { installed: installedId } : {}),
    capabilities: CAPABILITIES,
  })
  const remove = async (profile: Profile, record: Installed) => {
    await saveRegistry(
      profile,
      withRecords(profile.registry.extensions.filter((r) => r !== record)),
    )
    unload(profile, record.id)
    profile.errors.delete(record.id)
    await rm(installed(profile.id, record.directory), { recursive: true, force: true })
  }
  const toggle = async (profile: Profile, record: Installed, on: boolean) => {
    const next = { ...record, enabled: on }
    await saveRegistry(
      profile,
      withRecords(profile.registry.extensions.map((r) => (r === record ? next : r))),
    )
    if (!on) {
      unload(profile, record.id)
      profile.errors.delete(record.id)
    } else if (!profile.session.extensions.getExtension(record.id)) await load(profile, next)
  }
  /**
   * `chrome.permissions.request` from a running extension. The library refuses undeclared
   * permissions but records any origin, so origins must be declared match patterns too. Nothing
   * is granted without the user's answer to a prompt naming the extension and profile.
   */
  const requestPermissions = async (
    profileId: string,
    extension: Electron.Extension,
    request: unknown,
  ) => {
    if (!enabled() || !request || typeof request !== 'object') return false
    const field = (key: string) => {
      const value: unknown = Reflect.get(request, key)
      if (value === undefined) return []
      if (!Array.isArray(value) || value.length > 50) return undefined
      const values = strings(value)
      return values.length === value.length && values.every((v) => v.length <= 500)
        ? values
        : undefined
    }
    const permissions = field('permissions')
    const origins = field('origins')
    if (!permissions || !origins || (!permissions.length && !origins.length)) return false
    const manifest: unknown = extension.manifest
    const declared = (key: string) =>
      manifest && typeof manifest === 'object' ? strings(Reflect.get(manifest, key)) : []
    const declaredPermissions = [...declared('permissions'), ...declared('optional_permissions')]
    const declaredOrigins = [
      ...declared('host_permissions'),
      ...declared('optional_host_permissions'),
    ]
    if (!permissions.every((p) => declaredPermissions.includes(p))) return false
    if (!origins.every((o) => MATCH_PATTERN.test(o) && declaredOrigins.includes(o))) return false
    const name = (extension.name || extension.id).slice(0, 100)
    const detail = [
      ...(permissions.length ? [`Permissions: ${permissions.join(', ')}`] : []),
      ...(origins.length ? [`Site access: ${origins.join(', ')}`] : []),
      `This only applies to the browser profile “${profileName(profileId)}”.`,
    ].join('\n\n')
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Extension permission request',
      message: `Allow “${name}” more access in browser profile “${profileName(profileId)}”?`,
      detail: detail.slice(0, 4000),
      buttons: ['Allow', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
    const parent = tabs.window(profileId)
    const { response } = await (parent
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options))
    // The prompt can stay open while Browser is turned off or the extension is removed.
    return (
      response === 0 &&
      enabled() &&
      !!ready.get(profileId)?.session.extensions.getExtension(extension.id)
    )
  }
  /** Nothing from the copy runs until the user accepts what it can access. */
  const review = async (
    window: BrowserWindow,
    directory: string,
    manifest: { [key: string]: unknown },
  ) => {
    const permissions = strings(manifest.permissions)
    const optional = strings(manifest.optional_permissions)
    const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []
    const sites = [
      ...new Set([
        ...strings(manifest.host_permissions),
        ...strings(manifest.optional_host_permissions),
        ...scripts.flatMap((script: unknown) =>
          script && typeof script === 'object' && 'matches' in script
            ? strings(script.matches)
            : [],
        ),
      ]),
    ]
    const unsupported = permissions.filter((p) => !SUPPORTED_PERMISSIONS.has(p))
    const list = (values: string[]) =>
      values.length > 20
        ? `${values.slice(0, 20).join(', ')} and ${values.length - 20} more`
        : values.join(', ')
    const detail = [
      `Permissions: ${list(permissions) || 'none'}`,
      ...(optional.length ? [`Optional permissions: ${list(optional)}`] : []),
      `Site access: ${list(sites) || 'none'}`,
      ...(unsupported.length ? [`Not available in Dovo: ${list(unsupported)}`] : []),
      ...([permissions, optional].some((list) => list.includes('nativeMessaging'))
        ? [
            'Desktop app access: can connect to installed Chrome native helpers after you approve the connection.',
          ]
        : []),
      'It runs only in this browser profile and can read and change the pages it can access there.',
    ].join('\n\n')
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Review browser extension',
      message: `Add “${(await displayName(directory, manifest)).slice(0, 100)}” to this browser profile?`,
      detail: detail.slice(0, 4000),
      buttons: ['Add extension', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return response === 0
  }
  const installFolder = async (profile: Profile, window: BrowserWindow, source: string) => {
    requireEnabled()
    const manifest = await readManifest(source)
    if (manifest.manifest_version !== 3)
      throw new Error('Dovo supports Manifest V3 extensions only.')
    const directory = randomUUID()
    const staging = join(profileRoot(profile.id), 'installed', `.${directory}.staging`)
    const target = installed(profile.id, directory)
    let committed = false
    try {
      await copyTree(source, staging, { entries: 0, bytes: 0 })
      const copy = await readManifest(staging)
      const removedPermissions: string[] = []
      if (!(await review(window, staging, copy))) return
      // Browser can be turned off while the folder picker or review is open.
      requireEnabled()
      await rename(staging, target)
      // A manifest key keeps one identity across installs: replace that copy, keeping its storage.
      const key = copy.key
      const previous =
        typeof key === 'string'
          ? profile.registry.extensions.find((r) => r.id === keyId(key))
          : undefined
      if (previous) unload(profile, previous.id)
      const restorePrevious = async () => {
        if (previous?.enabled && enabled()) await load(profile, previous)
      }
      let extension: Electron.Extension
      try {
        extension = await profile.session.extensions.loadExtension(target)
      } catch (error) {
        await restorePrevious()
        throw new Error(
          `This extension could not be loaded: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`,
        )
      }
      if (!enabled()) {
        profile.session.extensions.removeExtension(extension.id)
        requireEnabled()
      }
      if (!previous && profile.registry.extensions.some((r) => r.id === extension.id)) {
        profile.session.extensions.removeExtension(extension.id)
        throw new Error('This extension is already installed in this browser profile.')
      }
      try {
        await saveRegistry(
          profile,
          withRecords([
            ...profile.registry.extensions.filter((r) => r !== previous),
            { id: extension.id, directory, enabled: true, removedPermissions },
          ]),
        )
      } catch {
        profile.session.extensions.removeExtension(extension.id)
        await restorePrevious()
        throw new Error('Dovo could not save the extension list, so the extension was not added.')
      }
      committed = true
      if (previous)
        await rm(installed(profile.id, previous.directory), { recursive: true, force: true })
      return extension.id
    } finally {
      await rm(staging, { recursive: true, force: true })
      if (!committed) await rm(target, { recursive: true, force: true })
    }
  }

  const install = async (profile: Profile, window: BrowserWindow, storeUrl?: string) => {
    requireEnabled()
    if (storeUrl === undefined) {
      const choice = await dialog.showOpenDialog(window, {
        title: 'Add an unpacked browser extension',
        buttonLabel: 'Choose folder',
        properties: ['openDirectory'],
      })
      if (choice.canceled || !choice.filePaths[0]) return
      return installFolder(profile, window, choice.filePaths[0])
    }
    const id = chromeStoreId(storeUrl)
    const source = await mkdtemp(join(tmpdir(), 'dovo-web-store-'))
    try {
      const bytes = await downloadStoreExtension(id, process.versions.chrome)
      requireEnabled()
      const key = await unpackStoreExtension(bytes, id, source)
      const manifest = await readManifest(source)
      // Packed IDs come from the verified developer key, not the temporary extraction path.
      manifest.key = key
      await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest, null, 2))
      return await installFolder(profile, window, source)
    } finally {
      await rm(source, { recursive: true, force: true })
    }
  }

  return {
    /** Load a profile's enabled extensions before its first shared-browser page. */
    prepare: async (profileId: string) => {
      if (!enabled()) return
      await open(profileId)
    },
    /**
     * Apply the saved Browser setting: while it is off no extension or background worker runs.
     * Each extension's own enabled flag stays saved for the next opt-in.
     */
    sync: async () => {
      const on = enabled()
      const profiles = await opened()
      // Stopping never waits behind a queued install or its open dialogs.
      if (!on) for (const profile of profiles) unloadAll(profile)
      if (on)
        for (const profile of profiles)
          await change(profile, async () => {
            if (!enabled()) return
            for (const record of profile.registry.extensions)
              if (record.enabled && !profile.session.extensions.getExtension(record.id))
                await load(profile, record)
          })
      return on
    },
    dispose: async () => {
      for (const profile of await opened()) unloadAll(profile)
    },
    /** Whether a URL is a page of an extension running in this profile. */
    ownsUrl: (profileId: string, url: string) => {
      const profile = ready.get(profileId)
      if (!profile) return false
      try {
        const parsed = new URL(url)
        return (
          parsed.protocol === 'chrome-extension:' &&
          EXTENSION.test(parsed.host) &&
          !!profile.session.extensions.getExtension(parsed.host)
        )
      } catch {
        return false
      }
    },
    addTab: (profileId: string, contents: Electron.WebContents, window: BaseWindow) => {
      if (!contents.isDestroyed()) ready.get(profileId)?.extensions.addTab(contents, window)
    },
    selectTab: (profileId: string, contents: Electron.WebContents) => {
      if (!contents.isDestroyed()) ready.get(profileId)?.extensions.selectTab(contents)
    },
    /** Call before closing; the library also forgets tabs whose contents are destroyed. */
    removeTab: (profileId: string, contents: Electron.WebContents) => {
      if (!contents.isDestroyed()) ready.get(profileId)?.extensions.removeTab(contents)
    },
    handle: async (
      window: BrowserWindow,
      raw: unknown,
    ): Promise<BrowserExtensionsResult | undefined> => {
      requireEnabled()
      const command = decode(browserExtensionCommandSchema, raw)
      const profile = await open(command.profileId)
      if (!('id' in command))
        return command.action === 'list'
          ? result(profile)
          : change(profile, async () =>
              result(
                profile,
                await install(
                  profile,
                  window,
                  command.action === 'installStore' ? command.url : undefined,
                ),
              ),
            )
      const record = profile.registry.extensions.find((r) => r.id === command.id)
      if (!record) throw new Error('This extension is not installed in this browser profile.')
      if (command.action === 'open') {
        const contents = tabs.find(window, command.key, command.profileId)
        if (!contents) throw new Error('Open a page in this browser profile first.')
        if (!profile.session.extensions.getExtension(record.id))
          throw new Error('Enable this extension before opening it.')
        const [width, height] = window.getContentSize()
        const { anchor } = command
        if (anchor.x >= width || anchor.y >= height) throw new Error('Invalid toolbar position.')
        clickAction(profile.extensions, {
          eventType: 'click',
          extensionId: record.id,
          tabId: contents.id,
          anchorRect: anchor,
        })
        return
      }
      return change(profile, async () => {
        // Queued work runs later: Browser may be off now, and records may have been replaced.
        requireEnabled()
        const current = profile.registry.extensions.find((r) => r.id === command.id)
        if (!current) throw new Error('This extension is not installed in this browser profile.')
        if (command.action === 'remove') await remove(profile, current)
        else await toggle(profile, current, command.action === 'enable')
        return result(profile)
      })
    },
  }
}
