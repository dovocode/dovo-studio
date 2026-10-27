import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const f = vi.hoisted(() => {
  const toId = (bytes: Buffer | string) =>
    createHash('sha256')
      .update(bytes)
      .digest('hex')
      .slice(0, 32)
      .split('')
      .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
      .join('')
  type Loaded = { id: string; name: string; version: string; path: string }
  const sessions = new Map<string, ReturnType<typeof fakeSession>>()
  function fakeSession(partition: string) {
    const loaded = new Map<string, Loaded>()
    return {
      partition,
      loaded,
      fail: undefined as string | undefined,
      registerPreloadScript: vi.fn<(script: unknown) => void>(),
      extensions: {
        loadExtension: vi.fn<(path: string) => Promise<Loaded>>(async (path) => {
          const session = sessions.get(partition)!
          if (session.fail) throw new Error(session.fail)
          const { readFile } = await import('node:fs/promises')
          const manifest = JSON.parse(await readFile(`${path}/manifest.json`, 'utf8'))
          const id =
            typeof manifest.key === 'string'
              ? toId(Buffer.from(manifest.key, 'base64'))
              : toId(path)
          if (loaded.has(id)) throw new Error('Extension is already loaded')
          const extension = { id, name: manifest.name, version: manifest.version, path }
          loaded.set(id, extension)
          return extension
        }),
        removeExtension: vi.fn<(id: string) => void>((id) => void loaded.delete(id)),
        getExtension: (id: string) => loaded.get(id) ?? null,
        getAllExtensions: () => [...loaded.values()],
      },
    }
  }
  return {
    toId,
    sessions,
    fakeSession,
    userData: '',
    enabled: true,
    zoom: vi.fn<() => number>(() => 1),
    dialog: vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    review: vi.fn<
      (
        window: unknown,
        options: { message: string; detail: string; buttons: string[] },
      ) => Promise<{
        response: number
      }>
    >(async () => ({ response: 0 })),
    instances: [] as Array<{
      options: {
        session: unknown
        modulePath: string
        createTab: Function
        removeTab: Function
        createWindow: Function
        requestPermissions: (extension: unknown, request: unknown) => Promise<boolean>
      }
      addTab: ReturnType<typeof vi.fn>
      selectTab: ReturnType<typeof vi.fn>
      removeTab: ReturnType<typeof vi.fn>
      api: { browserAction: { activateClick: ReturnType<typeof vi.fn> } }
    }>,
  }
})
vi.mock('electron', () => ({
  app: { getPath: () => f.userData },
  dialog: { showOpenDialog: f.dialog, showMessageBox: f.review },
  session: {
    fromPartition: (partition: string) => {
      let session = f.sessions.get(partition)
      if (!session) f.sessions.set(partition, (session = f.fakeSession(partition)))
      return session
    },
  },
}))
vi.mock('electron-chrome-extensions', () => ({
  ElectronChromeExtensions: class {
    on = vi.fn<(...args: unknown[]) => void>()
    addTab = vi.fn<(...args: unknown[]) => void>()
    selectTab = vi.fn<(...args: unknown[]) => void>()
    removeTab = vi.fn<(...args: unknown[]) => void>()
    api = { browserAction: { activateClick: vi.fn<(details: unknown) => void>() } }
    constructor(public options: never) {
      f.instances.push(this as never)
    }
  },
}))
vi.mock('./browser-native-messaging', () => ({
  attachNativeMessaging: () => ({ close: vi.fn<() => void>() }),
}))
vi.mock('electron-chrome-extensions/preload?raw', () => ({ default: '/* crx preload */' }))
vi.mock('@dovo/protocol/local-settings', () => ({
  readLocalSettingsSection: () => ({
    browserWorkspaceEnabled: f.enabled,
    browserProfiles: [{ id: 'work', name: 'Work' }],
  }),
}))
import {
  ACTION_LIBRARY_VERSION,
  createBrowserExtensions,
  type ExtensionTabHost,
} from './browser-extensions'

let root = ''
const window = {
  getContentSize: () => [900, 700],
  webContents: { getZoomFactor: f.zoom },
} as never
const tabs = {
  create: vi.fn<ExtensionTabHost['create']>(async () => [{}, {}] as never),
  close: vi.fn<ExtensionTabHost['close']>(),
  find: vi.fn<ExtensionTabHost['find']>(() => undefined),
  window: vi.fn<ExtensionTabHost['window']>(() => undefined),
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
beforeEach(async () => {
  vi.clearAllMocks()
  root = await mkdtemp(join(tmpdir(), 'dovo-browser-extensions-'))
  f.userData = join(root, 'user-data')
  f.enabled = true
  f.sessions.clear()
  f.instances.length = 0
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
async function fixture(name: string, manifest: object = {}) {
  const directory = join(root, name)
  await mkdir(join(directory, 'icons'), { recursive: true })
  await writeFile(join(directory, 'icons', 'icon32.png'), PNG)
  await writeFile(join(directory, 'popup.html'), '<p>popup</p>')
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name,
      version: '1.0.0',
      action: {
        default_popup: 'popup.html',
        default_title: 'Fixture',
        default_icon: { 32: 'icons/icon32.png' },
      },
      background: { service_worker: 'sw.js' },
      permissions: ['storage', 'tabs', 'nativeMessaging', 'downloads'],
      ...manifest,
    }),
  )
  return directory
}
const choose = (directory?: string) =>
  f.dialog.mockResolvedValueOnce(
    directory ? { canceled: false, filePaths: [directory] } : { canceled: true, filePaths: [] },
  )
const installedCopies = (profileId: string) =>
  readdir(join(f.userData, 'browser-extensions', 'profiles', profileId, 'installed'))
const workSession = () => f.sessions.get('persist:dovo-browser-workspace:work')!

it('refuses commands and stays unloaded while the experimental browser is disabled', async () => {
  f.enabled = false
  const extensions = createBrowserExtensions(tabs)
  await extensions.prepare('work')
  expect(f.sessions.size).toBe(0)
  await expect(extensions.handle(window, { action: 'list', profileId: 'work' })).rejects.toThrow(
    'Enable experimental Browser',
  )
})

it('reviews and preserves nativeMessaging in a managed copy, leaving the chosen folder untouched', async () => {
  const source = await fixture('Fixture')
  const original = await readFile(join(source, 'manifest.json'), 'utf8')
  const extensions = createBrowserExtensions(tabs)
  choose(source)
  const result = await extensions.handle(window, { action: 'install', profileId: 'work' })
  expect(f.dialog).toHaveBeenCalledWith(
    window,
    expect.objectContaining({ properties: ['openDirectory'] }),
  )
  expect(result).toMatchObject({
    installed: expect.stringMatching(/^[a-p]{32}$/),
    capabilities: {
      unpackedFolders: true,
      nativeMessaging: true,
      chromeWebStore: true,
      remoteRuntimes: false,
    },
    extensions: [
      {
        name: 'Fixture',
        version: '1.0.0',
        enabled: true,
        loaded: true,
        title: 'Fixture',
        popup: true,
        icon: `data:image/png;base64,${PNG.toString('base64')}`,
        unsupportedPermissions: ['downloads'],
        removedPermissions: [],
      },
    ],
  })
  expect(await readFile(join(source, 'manifest.json'), 'utf8')).toBe(original)
  const [copy] = await installedCopies('work')
  const managed = JSON.parse(
    await readFile(
      join(
        f.userData,
        'browser-extensions',
        'profiles',
        'work',
        'installed',
        copy!,
        'manifest.json',
      ),
      'utf8',
    ),
  )
  expect(managed.permissions).toEqual(['storage', 'tabs', 'nativeMessaging', 'downloads'])
  const session = workSession()
  expect(session.registerPreloadScript.mock.calls.map(([script]) => script)).toEqual([
    {
      id: 'dovo-browser-alias-frame',
      type: 'frame',
      filePath: expect.stringContaining('browser-alias.preload.js'),
    },
    {
      id: 'dovo-browser-alias-service-worker',
      type: 'service-worker',
      filePath: expect.stringContaining('browser-alias.preload.js'),
    },
  ])
  const runtime = join(f.userData, 'browser-extensions', 'runtime')
  expect(f.instances[0]!.options).toMatchObject({ session, modulePath: runtime })
  expect(await readFile(join(runtime, 'dist', 'chrome-extension-api.preload.js'), 'utf8')).toBe(
    '/* crx preload */',
  )
  const alias = await readFile(join(runtime, 'browser-alias.preload.js'), 'utf8')
  expect(alias).toContain("location.href.startsWith('chrome-extension://')")
  expect(alias).not.toContain('nodeIntegration')
})

it('keeps profiles apart and reloads only enabled extensions on the next start', async () => {
  const first = createBrowserExtensions(tabs)
  choose(await fixture('One'))
  const one = (await first.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  choose(await fixture('Two'))
  const two = (await first.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  await first.handle(window, { action: 'disable', profileId: 'work', id: two })
  await expect(
    first.handle(window, { action: 'list', profileId: 'personal' }),
  ).resolves.toMatchObject({
    extensions: [],
  })
  expect(f.sessions.get('persist:dovo-browser-workspace:personal')!.loaded.size).toBe(0)
  f.sessions.clear()
  const restarted = createBrowserExtensions(tabs)
  await restarted.prepare('work')
  expect([...workSession().loaded.keys()]).toEqual([one])
  await expect(
    restarted.handle(window, { action: 'list', profileId: 'work' }),
  ).resolves.toMatchObject({
    extensions: [
      { id: one, enabled: true, loaded: true },
      { id: two, enabled: false, loaded: false },
    ],
  })
})

it('enables, disables and removes an extension with its managed copy', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Fixture'))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  await expect(
    extensions.handle(window, { action: 'disable', profileId: 'work', id }),
  ).resolves.toMatchObject({
    extensions: [{ id, enabled: false, loaded: false }],
  })
  await expect(
    extensions.handle(window, { action: 'enable', profileId: 'work', id }),
  ).resolves.toMatchObject({
    extensions: [{ id, enabled: true, loaded: true }],
  })
  await expect(
    extensions.handle(window, { action: 'remove', profileId: 'work', id }),
  ).resolves.toMatchObject({
    extensions: [],
  })
  expect(workSession().loaded.size).toBe(0)
  expect(await installedCopies('work')).toEqual([])
  await expect(
    extensions.handle(window, { action: 'remove', profileId: 'work', id }),
  ).rejects.toThrow('not installed')
})

it('rejects unsafe or unsupported folders and leaves no partial copy', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose()
  await expect(
    extensions.handle(window, { action: 'install', profileId: 'work' }),
  ).resolves.not.toHaveProperty('installed')
  const legacy = await fixture('Legacy', { manifest_version: 2 })
  choose(legacy)
  await expect(extensions.handle(window, { action: 'install', profileId: 'work' })).rejects.toThrow(
    'Manifest V3 extensions only',
  )
  const empty = join(root, 'empty')
  await mkdir(empty)
  choose(empty)
  await expect(extensions.handle(window, { action: 'install', profileId: 'work' })).rejects.toThrow(
    'manifest.json',
  )
  const linked = await fixture('Linked')
  await symlink('/etc/hostname', join(linked, 'outside'))
  choose(linked)
  await expect(extensions.handle(window, { action: 'install', profileId: 'work' })).rejects.toThrow(
    'regular files and folders',
  )
  const broken = await fixture('Broken')
  workSession().fail = 'Manifest is not valid JSON.'
  choose(broken)
  await expect(extensions.handle(window, { action: 'install', profileId: 'work' })).rejects.toThrow(
    'could not be loaded: Manifest is not valid JSON.',
  )
  expect(await installedCopies('work')).toEqual([])
  await expect(extensions.handle(window, { action: 'list', profileId: '../work' })).rejects.toThrow(
    /profileId/,
  )
  await expect(
    extensions.handle(window, { action: 'enable', profileId: 'work', id: '../../etc' }),
  ).rejects.toThrow(/id: Expected a string matching/)
})

it('replaces a keyed extension in place, keeping its identity', async () => {
  const key = Buffer.from('fixture public key').toString('base64')
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Keyed', { key, version: '1.0.0' }))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  expect(id).toBe(f.toId(Buffer.from(key, 'base64')))
  choose(await fixture('Keyed v2', { key, version: '2.0.0' }))
  await expect(
    extensions.handle(window, { action: 'install', profileId: 'work' }),
  ).resolves.toMatchObject({
    installed: id,
    extensions: [{ id, version: '2.0.0', loaded: true }],
  })
  expect(await installedCopies('work')).toHaveLength(1)
})

it('reports a damaged extension list instead of silently replacing it', async () => {
  const directory = join(f.userData, 'browser-extensions', 'profiles', 'work')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'registry.json'),
    JSON.stringify({ version: 1, extensions: [{ id: 'x' }] }),
  )
  await expect(
    createBrowserExtensions(tabs).handle(window, { action: 'list', profileId: 'work' }),
  ).rejects.toThrow('damaged')
})

it('opens an action popup only for a loaded extension on a shared-browser tab of that profile', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Fixture'))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  const open = {
    action: 'open',
    profileId: 'work',
    id,
    key: 'tab',
    anchor: { x: 800, y: 0, width: 32, height: 32 },
  }
  await expect(extensions.handle(window, open)).rejects.toThrow('Open a page')
  expect(tabs.find).toHaveBeenCalledWith(window, 'tab', 'work')
  tabs.find.mockReturnValue({ id: 7 } as never)
  await extensions.handle(window, open)
  expect(f.instances[0]!.api.browserAction.activateClick).toHaveBeenCalledWith({
    eventType: 'click',
    extensionId: id,
    tabId: 7,
    anchorRect: { x: 800, y: 0, width: 32, height: 32 },
  })
  f.zoom.mockReturnValueOnce(1.25)
  await extensions.handle(window, { ...open, anchor: { x: 600, y: 40, width: 32, height: 32 } })
  expect(f.instances[0]!.api.browserAction.activateClick).toHaveBeenLastCalledWith({
    eventType: 'click',
    extensionId: id,
    tabId: 7,
    anchorRect: { x: 750, y: 50, width: 40, height: 40 },
  })
  await expect(
    extensions.handle(window, { ...open, anchor: { x: 950, y: 0, width: 32, height: 32 } }),
  ).rejects.toThrow('Invalid toolbar position')
  await extensions.handle(window, { action: 'disable', profileId: 'work', id })
  await expect(extensions.handle(window, open)).rejects.toThrow('Enable this extension')
  tabs.find.mockReturnValue(undefined)
})

it('connects library tab and window requests to Dovo tabs, refusing extension windows', async () => {
  const extensions = createBrowserExtensions(tabs)
  await extensions.prepare('work')
  const { options } = f.instances[0]!
  await options.createTab({ url: 'https://example.com/' })
  expect(tabs.create).toHaveBeenCalledWith('work', { url: 'https://example.com/' })
  const contents = { isDestroyed: () => false }
  options.removeTab(contents)
  expect(tabs.close).toHaveBeenCalledWith(contents)
  await expect(options.createWindow({ url: 'https://example.com/' })).rejects.toThrow(
    'extension windows',
  )
  extensions.addTab('work', contents as never, window)
  extensions.selectTab('work', contents as never)
  extensions.removeTab('work', contents as never)
  expect(f.instances[0]!.addTab).toHaveBeenCalledWith(contents, window)
  expect(f.instances[0]!.selectTab).toHaveBeenCalledWith(contents)
  expect(f.instances[0]!.removeTab).toHaveBeenCalledWith(contents)
  extensions.addTab('personal', contents as never, window)
  expect(f.instances).toHaveLength(1)
})

it('pins the electron-chrome-extensions internals the action adapter was verified against', async () => {
  const library = join(__dirname, '..', 'node_modules', 'electron-chrome-extensions')
  const installed = JSON.parse(await readFile(join(library, 'package.json'), 'utf8'))
  const desktop = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8'))
  expect(installed.version).toBe(ACTION_LIBRARY_VERSION)
  expect(desktop.dependencies['electron-chrome-extensions']).toBe(ACTION_LIBRARY_VERSION)
  const source = await readFile(join(library, 'dist', 'cjs', 'index.js'), 'utf8')
  expect(source).toContain(
    'activateClick(details) {\n    const { extensionId, tabId, anchorRect, alignment } = details;',
  )
  expect(source).toContain('browserAction: new BrowserActionAPI(this.ctx)')
})

it('refuses to open a popup when the library no longer exposes the verified action shape', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Fixture'))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  tabs.find.mockReturnValue({ id: 7 } as never)
  ;(f.instances[0] as unknown as { api: unknown }).api = { browserAction: {} }
  await expect(
    extensions.handle(window, {
      action: 'open',
      profileId: 'work',
      id,
      key: 'tab',
      anchor: { x: 0, y: 0, width: 32, height: 32 },
    }),
  ).rejects.toThrow('Extension popups are unavailable in this build.')
  tabs.find.mockReturnValue(undefined)
})

it('stops every extension while Browser is off and restores saved enables on opt-in', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('One'))
  const one = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!
    .installed!
  choose(await fixture('Two'))
  const two = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!
    .installed!
  await extensions.handle(window, { action: 'disable', profileId: 'work', id: two })
  f.enabled = false
  await expect(extensions.sync()).resolves.toBe(false)
  expect(workSession().loaded.size).toBe(0)
  await extensions.prepare('work')
  expect(workSession().loaded.size).toBe(0)
  await expect(extensions.handle(window, { action: 'list', profileId: 'work' })).rejects.toThrow(
    'Enable experimental Browser',
  )
  const registry = JSON.parse(
    await readFile(
      join(f.userData, 'browser-extensions', 'profiles', 'work', 'registry.json'),
      'utf8',
    ),
  )
  expect(registry.extensions.map((e: { enabled: boolean }) => e.enabled)).toEqual([true, false])
  f.enabled = true
  await expect(extensions.sync()).resolves.toBe(true)
  expect([...workSession().loaded.keys()]).toEqual([one])
  await extensions.dispose()
  expect(workSession().loaded.size).toBe(0)
})

it('does not start extensions for a profile that finishes opening after Browser is turned off', async () => {
  const first = createBrowserExtensions(tabs)
  choose(await fixture('One'))
  await first.handle(window, { action: 'install', profileId: 'work' })
  f.sessions.clear()
  const restarted = createBrowserExtensions(tabs)
  const opening = restarted.prepare('work')
  f.enabled = false
  await opening
  expect(workSession().loaded.size).toBe(0)
})

it('reviews optional nativeMessaging without granting undeclared access', async () => {
  const source = await fixture('Optional', {
    permissions: ['storage'],
    optional_permissions: ['nativeMessaging', 'bookmarks'],
  })
  const extensions = createBrowserExtensions(tabs)
  choose(source)
  await expect(
    extensions.handle(window, { action: 'install', profileId: 'work' }),
  ).resolves.toMatchObject({
    extensions: [{ removedPermissions: [] }],
  })
  const [copy] = await installedCopies('work')
  const managed = JSON.parse(
    await readFile(
      join(
        f.userData,
        'browser-extensions',
        'profiles',
        'work',
        'installed',
        copy!,
        'manifest.json',
      ),
      'utf8',
    ),
  )
  expect(managed.optional_permissions).toEqual(['nativeMessaging', 'bookmarks'])
  const { requestPermissions } = f.instances[0]!.options
  const [loadedId] = workSession().loaded.keys()
  const extension = { id: loadedId!, name: 'Optional', manifest: managed }
  f.review.mockClear()
  await expect(requestPermissions(extension, { permissions: ['nativeMessaging'] })).resolves.toBe(
    true,
  )
  await expect(
    requestPermissions(extension, { permissions: ['tabs', 'nativeMessaging'] }),
  ).resolves.toBe(false)
  expect(f.review).toHaveBeenCalledOnce()
  await expect(requestPermissions(extension, { permissions: ['bookmarks'] })).resolves.toBe(true)
  expect(f.review).toHaveBeenCalledTimes(2)
})

it('restores a reviewed nativeMessaging extension after restart', async () => {
  const first = createBrowserExtensions(tabs)
  choose(await fixture('Fixture'))
  const id = (await first.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  f.sessions.clear()
  const restarted = createBrowserExtensions(tabs)
  await restarted.prepare('work')
  expect(workSession().loaded.size).toBe(1)
  await expect(
    restarted.handle(window, { action: 'list', profileId: 'work' }),
  ).resolves.toMatchObject({
    extensions: [{ id, loaded: true }],
  })
})

it('shows permissions for review before anything from the copy loads, and cancels cleanly', async () => {
  const source = await fixture('Reviewed', {
    host_permissions: ['https://example.com/*'],
    content_scripts: [{ matches: ['https://docs.example.com/*'], js: ['cs.js'] }],
  })
  const extensions = createBrowserExtensions(tabs)
  await extensions.prepare('work')
  f.review.mockImplementationOnce(async () => {
    expect(workSession().extensions.loadExtension).not.toHaveBeenCalled()
    return { response: 1 }
  })
  choose(source)
  await expect(
    extensions.handle(window, { action: 'install', profileId: 'work' }),
  ).resolves.not.toHaveProperty('installed')
  const [, options] = f.review.mock.calls[0]!
  expect(options.message).toBe('Add “Reviewed” to this browser profile?')
  expect(options.buttons).toEqual(['Add extension', 'Cancel'])
  expect(options.detail).toContain('Permissions: storage, tabs, nativeMessaging, downloads')
  expect(options.detail).toContain('Site access: https://example.com/*, https://docs.example.com/*')
  expect(options.detail).toContain('Not available in Dovo: downloads')
  expect(options.detail).toContain(
    'Desktop app access: can connect to installed Chrome native helpers',
  )
  expect(workSession().extensions.loadExtension).not.toHaveBeenCalled()
  expect(await installedCopies('work')).toEqual([])
  await expect(
    extensions.handle(window, { action: 'list', profileId: 'work' }),
  ).resolves.toMatchObject({ extensions: [] })
})

it('names localized extensions in the review', async () => {
  const source = await fixture('Localized', { name: '__MSG_appName__', default_locale: 'en' })
  await mkdir(join(source, '_locales', 'en'), { recursive: true })
  await writeFile(
    join(source, '_locales', 'en', 'messages.json'),
    JSON.stringify({ appName: { message: 'Password Helper' } }),
  )
  f.review.mockResolvedValueOnce({ response: 1 })
  choose(source)
  await createBrowserExtensions(tabs).handle(window, { action: 'install', profileId: 'work' })
  expect(f.review.mock.calls[0]![1].message).toBe('Add “Password Helper” to this browser profile?')
})

/** Make the next registry rename fail by putting a non-empty folder where the file goes. */
async function blockRegistry(profileId: string) {
  const path = join(f.userData, 'browser-extensions', 'profiles', profileId, 'registry.json')
  await rm(path, { force: true })
  await mkdir(join(path, 'blocked'), { recursive: true })
  return () => rm(path, { recursive: true, force: true })
}

it('rolls an install back when the extension list cannot be saved', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const extensions = createBrowserExtensions(tabs)
  await extensions.prepare('work')
  const unblock = await blockRegistry('work')
  choose(await fixture('Unsaved'))
  await expect(extensions.handle(window, { action: 'install', profileId: 'work' })).rejects.toThrow(
    'could not save the extension list',
  )
  expect(workSession().loaded.size).toBe(0)
  expect((await installedCopies('work')).filter((name) => name !== 'registry.json')).toEqual([])
  await unblock()
  await expect(
    extensions.handle(window, { action: 'list', profileId: 'work' }),
  ).resolves.toMatchObject({ extensions: [] })
})

it('keeps a keyed extension and its copy when replacing it cannot be saved', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const key = Buffer.from('rollback key').toString('base64')
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Keyed', { key, version: '1.0.0' }))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  const unblock = await blockRegistry('work')
  choose(await fixture('Keyed v2', { key, version: '2.0.0' }))
  await expect(extensions.handle(window, { action: 'install', profileId: 'work' })).rejects.toThrow(
    'could not save',
  )
  expect([...workSession().loaded.values()].map((e) => [e.id, e.version])).toEqual([[id, '1.0.0']])
  expect(await installedCopies('work')).toHaveLength(1)
  await unblock()
})

it('changes nothing when removing or toggling cannot be saved', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Fixture'))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  const unblock = await blockRegistry('work')
  await expect(
    extensions.handle(window, { action: 'remove', profileId: 'work', id }),
  ).rejects.toThrow('could not save the extension list, so nothing changed')
  await expect(
    extensions.handle(window, { action: 'disable', profileId: 'work', id }),
  ).rejects.toThrow('could not save the extension list, so nothing changed')
  expect(workSession().loaded.has(id)).toBe(true)
  expect(await installedCopies('work')).toHaveLength(1)
  await unblock()
  await expect(
    extensions.handle(window, { action: 'list', profileId: 'work' }),
  ).resolves.toMatchObject({ extensions: [{ id, enabled: true, loaded: true }] })
})

it('asks before granting optional permissions or declared sites at runtime, cancel by default', async () => {
  const extensions = createBrowserExtensions(tabs)
  await extensions.prepare('work')
  const parent = { id: 3 }
  tabs.window.mockReturnValue(parent as never)
  const { requestPermissions } = f.instances[0]!.options
  const extension = {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    name: 'Helper',
    manifest: {
      permissions: ['storage'],
      optional_permissions: ['bookmarks'],
      host_permissions: ['https://example.com/*'],
      optional_host_permissions: ['https://*.example.org/*', '<all_urls>'],
    },
  }
  workSession().loaded.set(extension.id, { ...extension, version: '1', path: '/x' })
  f.review.mockResolvedValueOnce({ response: 0 })
  await expect(
    requestPermissions(extension, {
      permissions: ['bookmarks'],
      origins: ['https://*.example.org/*'],
    }),
  ).resolves.toBe(true)
  expect(tabs.window).toHaveBeenCalledWith('work')
  const [window, options] = f.review.mock.calls[0]!
  expect(window).toBe(parent)
  expect(options).toMatchObject({
    message: 'Allow “Helper” more access in browser profile “Work”?',
    buttons: ['Allow', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  })
  expect(options.detail).toContain('Permissions: bookmarks')
  expect(options.detail).toContain('Site access: https://*.example.org/*')
  f.review.mockResolvedValueOnce({ response: 1 })
  await expect(requestPermissions(extension, { origins: ['<all_urls>'] })).resolves.toBe(false)
  expect(f.review).toHaveBeenCalledTimes(2)
  f.review.mockClear()
  for (const request of [
    { origins: ['https://evil.example/*'] },
    { origins: ['file:///*'] },
    { origins: ['https://example.com/*\nAllow everything'] },
    { permissions: ['history'] },
    { permissions: 'bookmarks' },
    { permissions: [7] },
    { permissions: Array.from({ length: 51 }, () => 'bookmarks') },
    {},
    null,
  ])
    await expect(requestPermissions(extension, request)).resolves.toBe(false)
  expect(f.review).not.toHaveBeenCalled()
  f.enabled = false
  await expect(requestPermissions(extension, { permissions: ['bookmarks'] })).resolves.toBe(false)
  expect(f.review).not.toHaveBeenCalled()
  tabs.window.mockReturnValue(undefined)
})

/** Hold the next review dialog open until the test answers it. */
function pendingReview() {
  let answer = (_response: number) => {}
  f.review.mockImplementationOnce(
    () => new Promise((resolve) => (answer = (response) => resolve({ response }))),
  )
  return (response: number) => answer(response)
}

it('stops running extensions at once and refuses activation when Browser turns off during review', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Running'))
  const running = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!
    .installed!
  const answer = pendingReview()
  choose(await fixture('Pending'))
  const installing = extensions.handle(window, { action: 'install', profileId: 'work' })
  await vi.waitFor(() => expect(f.review).toHaveBeenCalledTimes(2))
  f.enabled = false
  await expect(extensions.sync()).resolves.toBe(false)
  expect(workSession().loaded.size).toBe(0)
  answer(0)
  await expect(installing).rejects.toThrow('Enable experimental Browser')
  expect(workSession().loaded.size).toBe(0)
  expect(await installedCopies('work')).toHaveLength(1)
  f.enabled = true
  await expect(
    extensions.handle(window, { action: 'list', profileId: 'work' }),
  ).resolves.toMatchObject({ extensions: [{ id: running, enabled: true, loaded: false }] })
})

it('refuses a queued enable once Browser is off by the time it runs', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Queued'))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  await extensions.handle(window, { action: 'disable', profileId: 'work', id })
  const answer = pendingReview()
  choose(await fixture('Blocking'))
  const installing = extensions.handle(window, { action: 'install', profileId: 'work' })
  await vi.waitFor(() => expect(f.review).toHaveBeenCalledTimes(2))
  const enabling = extensions.handle(window, { action: 'enable', profileId: 'work', id })
  f.enabled = false
  answer(1)
  await installing
  await expect(enabling).rejects.toThrow('Enable experimental Browser')
  expect(workSession().loaded.size).toBe(0)
  f.enabled = true
  await expect(
    extensions.handle(window, { action: 'list', profileId: 'work' }),
  ).resolves.toMatchObject({ extensions: [{ id, enabled: false }] })
})

it('rolls back an install whose load finishes after Browser was turned off', async () => {
  const extensions = createBrowserExtensions(tabs)
  await extensions.prepare('work')
  const session = workSession()
  const original = session.extensions.loadExtension.getMockImplementation()!
  session.extensions.loadExtension.mockImplementationOnce(async (path) => {
    const loaded = await original(path)
    f.enabled = false
    return loaded
  })
  choose(await fixture('Late'))
  await expect(extensions.handle(window, { action: 'install', profileId: 'work' })).rejects.toThrow(
    'Enable experimental Browser',
  )
  expect(session.loaded.size).toBe(0)
  expect(await installedCopies('work')).toEqual([])
})

it('denies a runtime permission accepted after Browser was turned off', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Asking', { optional_permissions: ['bookmarks'] }))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  const { requestPermissions } = f.instances[0]!.options
  const extension = { id, name: 'Asking', manifest: { optional_permissions: ['bookmarks'] } }
  const answer = pendingReview()
  const asking = requestPermissions(extension, { permissions: ['bookmarks'] })
  await vi.waitFor(() => expect(f.review).toHaveBeenCalledTimes(2))
  f.enabled = false
  answer(0)
  await expect(asking).resolves.toBe(false)
})

it('persists toolbar pins in the selected profile across restart and toggles', async () => {
  const extensions = createBrowserExtensions(tabs)
  choose(await fixture('Pinned helper'))
  const id = (await extensions.handle(window, { action: 'install', profileId: 'work' }))!.installed!
  await expect(
    extensions.handle(window, { action: 'pin', profileId: 'work', id }),
  ).resolves.toMatchObject({ extensions: [{ id, pinned: true, loaded: true }] })
  await extensions.handle(window, { action: 'disable', profileId: 'work', id })
  await extensions.dispose()
  const restarted = createBrowserExtensions(tabs)
  await expect(
    restarted.handle(window, { action: 'list', profileId: 'work' }),
  ).resolves.toMatchObject({ extensions: [{ id, pinned: true, enabled: false }] })
  await expect(
    restarted.handle(window, { action: 'list', profileId: 'personal' }),
  ).resolves.toMatchObject({ extensions: [] })
  await expect(
    restarted.handle(window, { action: 'unpin', profileId: 'work', id }),
  ).resolves.toMatchObject({ extensions: [{ id, pinned: false, enabled: false }] })
})
