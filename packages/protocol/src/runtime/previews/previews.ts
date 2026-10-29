import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { minValue, maxValue, urlSchema } from '../../shared/schema.js'
import { Schema } from 'effect'
import { threadWindowTargetSchema } from '../../thread-window.js'
import { browserTabLifecycleFields } from './browser-tab-lifecycle.js'
import { connectionSchema } from '../connection/runtime.js'
export function previewUrl(input: string, runtimeAddress?: string): string {
  const text = input.trim()
  if (
    !text ||
    (/^[a-z][a-z0-9+.-]*:/i.test(text) &&
      !/^https?:/i.test(text) &&
      !/^[^/]+:\d+(?:[/?#]|$)/.test(text))
  )
    throw new Error('Use an HTTP or HTTPS address.')
  const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP or HTTPS address without credentials.')
  if (runtimeAddress && ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname))
    url.hostname = new URL(runtimeAddress).hostname
  return url.href
}
export function deviceDeepLink(input: string): string {
  const value = input.trim()
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value) || /\p{Cc}/u.test(value))
    throw new Error('Use an absolute app deep link or HTTP/HTTPS URL.')
  const url = new URL(value)
  if (
    ['javascript:', 'data:', 'file:', 'vbscript:', 'intent:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Use an app deep link or HTTP/HTTPS URL without credentials.')
  return url.href
}
export const previewPresets = [
  {
    id: 'fill',
    name: 'Fit window',
    width: 0,
    height: 0,
  },
  {
    id: 'phone',
    name: 'Phone · 390 × 844',
    width: 390,
    height: 844,
  },
  {
    id: 'tablet',
    name: 'Tablet · 820 × 1180',
    width: 820,
    height: 1180,
  },
  {
    id: 'desktop',
    name: 'Desktop · 1440 × 900',
    width: 1440,
    height: 900,
  },
] as const
export const previewDeviceSchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  hostId: Schema.optional(Schema.String),
  hostName: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(['simulator', 'physical'])),
  connection: Schema.optional(Schema.String),
  liveSupported: Schema.optional(Schema.Boolean),
  platform: Schema.Literals(['ios', 'android']),
  state: Schema.Literals(['booted', 'stopped', 'starting']),
  runtime: Schema.String,
})
export type PreviewDevice = Schema.Schema.Type<typeof previewDeviceSchema>
export const previewDevicesSchema = mutableStruct({
  host: Schema.String,
  devices: mutableArray(previewDeviceSchema),
  diagnostics: mutableArray(Schema.String),
})
export const previewActionSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
  id: maxValue(minValue(Schema.String, 1), 500),
  hostId: Schema.optional(maxValue(minValue(Schema.String, 1), 80)),
  action: Schema.Literals([
    'boot',
    'shutdown',
    'open',
    'screenshot',
    'devicehub',
    'accessibility',
    'screen-recording',
    'apps',
    'launch',
    'relaunch',
    'portrait',
    'landscape',
    'light',
    'dark',
    'capabilities',
    'deep-link',
    'stop',
    'uninstall',
  ]),
  url: Schema.optional(maxValue(Schema.String, 4096)),
  bundleId: Schema.optional(
    maxValue(minValue(Schema.String, 1), 255).pipe(
      Schema.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)),
    ),
  ),
})
export const previewResultSchema = mutableStruct({
  ok: Schema.Literal(true),
  image: Schema.optional(Schema.String),
  controls: Schema.optional(mutableArray(Schema.String)),
  limitations: Schema.optional(mutableArray(Schema.String)),
  apps: Schema.optional(
    mutableArray(
      mutableStruct({
        name: Schema.String,
        bundleId: Schema.String,
      }),
    ),
  ),
})
export const browserWorkspaceTabSchema = mutableStruct({
  ...browserTabLifecycleFields,
  id: maxValue(minValue(Schema.String, 1), 200),
  url: maxValue(Schema.String, 8192),
  title: maxValue(Schema.String, 4096),
  kind: Schema.Literals(['web', 'remote']),
  profileId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/))),
  runtimeId: Schema.optional(Schema.String),
  favicon: Schema.optional(maxValue(Schema.String, 100000)),
  visitedAt: Schema.optional(Schema.Number),
  pinned: Schema.optional(Schema.Boolean),
  homeUrl: Schema.optional(maxValue(Schema.String, 4096)),
  thread: Schema.optional(
    mutableStruct({ id: Schema.String, runtimeId: Schema.NullOr(Schema.String) }),
  ),
})
export type BrowserWorkspaceTab = typeof browserWorkspaceTabSchema.Type
export const browserSitePermissionSchema = Schema.Literals([
  'notifications',
  'microphone',
  'camera',
  'clipboard-read',
  'clipboard-sanitized-write',
  'speaker-selection',
  'screen-wake-lock',
  'idle-detection',
  'persistent-storage',
  'automatic-pip',
  'geolocation',
  'geolocation-approximate',
  'fileSystem',
  'local-fonts',
  'usb',
  'hid',
  'serial',
  'bluetooth',
  'midi',
  'pointerLock',
  'keyboardLock',
  'window-management',
])
export const browserPermissionSettingSchema = Schema.Literals(['ask', 'allow', 'block'])
export type BrowserSitePermission = typeof browserSitePermissionSchema.Type
export type BrowserPermissionSetting = typeof browserPermissionSettingSchema.Type
export type BrowserSitePermissions = {
  origin: string
  permissions: Record<BrowserSitePermission, BrowserPermissionSetting>
  /** Permissions requested by this origin, including saved choices from earlier versions. */
  requested?: BrowserSitePermission[]
}
export const browserCommandSchema = Schema.Union([
  mutableStruct({
    action: Schema.Literal('zoom'),
    key: maxValue(minValue(Schema.String, 1), 500),
    direction: Schema.Literals(['in', 'out', 'reset']),
  }),
  mutableStruct({
    action: Schema.Literals(['print', 'save-pdf']),
    key: maxValue(minValue(Schema.String, 1), 500),
  }),
  mutableStruct({
    action: Schema.Literal('downloads'),
    key: maxValue(minValue(Schema.String, 1), 500),
    profileId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/))),
    operation: Schema.Literals([
      'list',
      'pause',
      'resume',
      'cancel',
      'retry',
      'open',
      'reveal',
      'folder',
    ]),
    id: Schema.optional(
      Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
    ),
  }),
  mutableStruct({
    action: Schema.Literal('find'),
    key: maxValue(minValue(Schema.String, 1), 500),
    text: maxValue(Schema.String, 1000),
    regex: Schema.Boolean,
    matchCase: Schema.Boolean,
    direction: Schema.optional(Schema.Literals(['next', 'previous'])),
  }),
  mutableStruct({
    action: Schema.Literal('stop-find'),
    key: maxValue(minValue(Schema.String, 1), 500),
    focus: Schema.optional(Schema.Boolean),
  }),
  mutableStruct({
    action: Schema.Literal('open-tab'),
    key: maxValue(minValue(Schema.String, 1), 500),
    tab: browserWorkspaceTabSchema,
  }),
  mutableStruct({
    action: Schema.Literal('keep-awake'),
    key: maxValue(minValue(Schema.String, 1), 500),
    enabled: Schema.Boolean,
    url: maxValue(minValue(Schema.String, 1), 8192),
    profileId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/))),
  }),
  mutableStruct({
    action: Schema.Literal('browser-windows'),
    key: maxValue(minValue(Schema.String, 1), 500),
  }),
  mutableStruct({
    action: Schema.Literal('move-tab'),
    key: maxValue(minValue(Schema.String, 1), 500),
    targetWindowId: Schema.optional(
      Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
    ),
    tab: browserWorkspaceTabSchema,
  }),
  mutableStruct({
    action: Schema.Literal('site-permissions'),
    key: maxValue(minValue(Schema.String, 1), 500),
  }),
  mutableStruct({
    action: Schema.Literal('clear-site-data'),
    origin: maxValue(minValue(Schema.String, 1), 8192),
    key: maxValue(minValue(Schema.String, 1), 500),
  }),
  mutableStruct({
    action: Schema.Literal('set-site-permission'),
    origin: maxValue(minValue(Schema.String, 1), 8192),
    key: maxValue(minValue(Schema.String, 1), 500),
    permission: browserSitePermissionSchema,
    setting: browserPermissionSettingSchema,
  }),
  mutableStruct({
    action: Schema.Literal('request-site-permission'),
    origin: maxValue(minValue(Schema.String, 1), 8192),
    key: maxValue(minValue(Schema.String, 1), 500),
    permission: Schema.Literals(['notifications', 'microphone', 'camera']),
  }),
  mutableStruct({
    action: Schema.Literal('external'),
    key: maxValue(minValue(Schema.String, 1), 500),
    url: urlSchema(),
  }),
  mutableStruct({
    action: Schema.Literal('show'),
    profileId: Schema.optional(
      Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/))),
    ),
    taskId: Schema.optional(Schema.String),
    agentAccess: Schema.optional(Schema.Boolean),
    /** Shared Browser activity only: queue new-tab requests, allow popups and forward tab shortcuts. */
    workspaceBrowser: Schema.optional(Schema.Boolean),
    key: maxValue(minValue(Schema.String, 1), 500),
    url: urlSchema(),
    viewport: Schema.optional(
      mutableStruct({
        width: maxValue(
          minValue(
            Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
              Schema.check(Schema.isInt()),
              Schema.check(
                Schema.isBetween({
                  minimum: Number.MIN_SAFE_INTEGER,
                  maximum: Number.MAX_SAFE_INTEGER,
                }),
              ),
            ),
            1,
          ),
          2000,
        ),
        height: maxValue(
          minValue(
            Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
              Schema.check(Schema.isInt()),
              Schema.check(
                Schema.isBetween({
                  minimum: Number.MIN_SAFE_INTEGER,
                  maximum: Number.MAX_SAFE_INTEGER,
                }),
              ),
            ),
            1,
          ),
          2000,
        ),
      }),
    ),
    bounds: mutableStruct({
      x: minValue(
        Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
          Schema.check(Schema.isInt()),
          Schema.check(
            Schema.isBetween({
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            }),
          ),
        ),
        0,
      ),
      y: minValue(
        Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
          Schema.check(Schema.isInt()),
          Schema.check(
            Schema.isBetween({
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            }),
          ),
        ),
        0,
      ),
      width: maxValue(
        minValue(
          Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
            Schema.check(Schema.isInt()),
            Schema.check(
              Schema.isBetween({
                minimum: Number.MIN_SAFE_INTEGER,
                maximum: Number.MAX_SAFE_INTEGER,
              }),
            ),
          ),
          1,
        ),
        5000,
      ),
      height: maxValue(
        minValue(
          Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
            Schema.check(Schema.isInt()),
            Schema.check(
              Schema.isBetween({
                minimum: Number.MIN_SAFE_INTEGER,
                maximum: Number.MAX_SAFE_INTEGER,
              }),
            ),
          ),
          1,
        ),
        5000,
      ),
    }),
  }),
  mutableStruct({
    action: Schema.Literal('watch-frames'),
    key: maxValue(minValue(Schema.String, 1), 500),
    enabled: Schema.Boolean,
  }),
  mutableStruct({
    action: Schema.Literal('hide'),
    key: maxValue(minValue(Schema.String, 1), 500),
    /** A temporary Studio overlay covers the selected page; this is not leaving its tab. */
    occluded: Schema.optional(Schema.Boolean),
    /** Return keyboard focus to the page after a passive overlay, unless Studio receives input. */
    preserveFocus: Schema.optional(Schema.Boolean),
  }),
  mutableStruct({
    action: Schema.Literals([
      'close',
      'back',
      'forward',
      'reload',
      'hard-reload',
      'devtools',
      'status',
      'screenshot',
      'selection',
      /** Window-wide `mediaRequests` and `captures` only; `key` is ignored, tab events untouched. */
      'media-status',
      /** Active media/sharing tab keys; never drains page-created tab events. */
      'tab-activity',
      'focus-tab',
    ]),
    key: maxValue(minValue(Schema.String, 1), 500),
    tabCount: Schema.optional(
      Schema.Number.pipe(
        Schema.check(Schema.isInt()),
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
      ),
    ),
  }),
  mutableStruct({
    action: Schema.Literal('set-audio-muted'),
    key: maxValue(minValue(Schema.String, 1), 500),
    muted: Schema.Boolean,
  }),
  /** Trusted Studio registers remote workspace tabs as potential sharing sources. */
  mutableStruct({
    action: Schema.Literal('remote-media-sources'),
    key: maxValue(minValue(Schema.String, 1), 500),
    sources: mutableArray(
      mutableStruct({
        key: maxValue(minValue(Schema.String, 1), 500),
        tabId: maxValue(minValue(Schema.String, 1), 200),
        profileId: maxValue(minValue(Schema.String, 1), 200),
        title: maxValue(Schema.String, 200),
        url: maxValue(Schema.String, 8192),
        connection: connectionSchema,
      }),
    ).pipe(Schema.check(Schema.isMaxLength(100))),
  }),
  mutableStruct({
    action: Schema.Literal('thread-media-sources'),
    key: maxValue(minValue(Schema.String, 1), 500),
    sources: mutableArray(threadWindowTargetSchema).pipe(Schema.check(Schema.isMaxLength(200))),
  }),
  /** Answer a pending `mediaRequests` entry; only shared-browser tabs ever create one. */
  mutableStruct({
    action: Schema.Literal('media'),
    /** Tab key of the requesting page, as listed in the request. */
    key: maxValue(minValue(Schema.String, 1), 500),
    requestId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f-]{36}$/))),
    decision: Schema.Literals(['allow', 'deny']),
    /** Camera/microphone only: remember this website's requested devices in this profile. */
    remember: Schema.optional(Schema.Boolean),
    /** Display requests: key of one of the request's `sources` to share as a whole tab. */
    source: Schema.optional(maxValue(minValue(Schema.String, 1), 500)),
    /** Display requests: also share that tab's audio (needs `audio` in the request). */
    audio: Schema.optional(Schema.Boolean),
  }),
  /** Ask the capturing page to stop; the capture stays listed until its tracks really end. */
  mutableStruct({
    action: Schema.Literal('stop-capture'),
    key: maxValue(minValue(Schema.String, 1), 500),
    captureId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f-]{36}$/))),
  }),
])
/** A page in a shared-browser tab asked to share a tab or use the camera or microphone. */
export type BrowserMediaRequest = {
  id: string
  /** `display`: `getDisplayMedia` (tab sharing). `user-media`: camera and/or microphone. */
  kind: 'display' | 'user-media' | 'notifications'
  /** Requesting tab key and profile. */
  key: string
  profileId: string
  /** Origin of the requesting page, e.g. `https://meet.google.com`. */
  origin: string
  video: boolean
  audio: boolean
  /** Epoch milliseconds; afterwards the request is denied automatically. */
  expiresAt: number
  /** Explicit choices across browser profiles and desktop surfaces; never thread previews. */
  sources?: {
    key: string
    title: string
    url: string
    requester: boolean
    kind?: 'tab' | 'remote' | 'thread' | 'window' | 'screen'
    profileId?: string
    audioSupported?: boolean
    thumbnail?: string
  }[]
  sourceError?: string
}
/** A tab being captured. Listed until its tracks really end, never just because Stop was asked. */
export type BrowserCapture = {
  id: string
  /** Tab key of the page that receives the capture. */
  key: string
  /** Tab key of the tab being shared. */
  sourceKey: string
  sourceKind?: 'tab' | 'remote' | 'thread' | 'window' | 'screen'
  /** The shared tab's current title and address, for naming it in the sharing indicator. */
  sourceTitle?: string
  sourceUrl?: string
  profileId: string
  origin: string
  audio: boolean
  /** `starting`: approved, page not yet holding tracks. `stopping`: Stop asked, tracks still live. */
  state: 'starting' | 'active' | 'stopping'
  /** Stop was asked but the page kept its tracks; only closing the capturing page ends it. */
  unresponsive?: boolean
}
export type BrowserCommand = Schema.Schema.Type<typeof browserCommandSchema>
export type BrowserDownloadItem = {
  id: number
  url: string
  filename: string
  state: 'in_progress' | 'complete' | 'interrupted'
  paused: boolean
  canResume: boolean
  bytesReceived: number
  totalBytes: number
  exists: boolean
  error?: string
}
export type BrowserFindResult = { active: number; total: number; error?: string; limited?: boolean }
export type BrowserCallTab = {
  key: string
  title: string
  url: string
  profileId: string
  teams: boolean
  pictureInPicture: boolean
}
export type BrowserFrame = { key: string; url: string; image: string }
/** Live native tab state; never persisted with the browser library. */
export type BrowserTabState = {
  key: string
  url: string
  title: string
  badge?: number | 'unread'
  audible: boolean
  muted: boolean
  camera: boolean
  microphone: boolean
  screenSharing: boolean
}
export type BrowserFrameBridge = (
  key: string,
  listener: (frame: BrowserFrame) => void,
) => () => void
export type BrowserBridge = (command: BrowserCommand) => Promise<
  | {
      url: string
      title?: string
      cdp?: string
      image?: string
      selection?: string
      favicon?: string | null
      faviconUpdates?: { key: string; url: string; favicon: string | null }[]
      tabStates?: BrowserTabState[]
      zoomFactor?: number
      downloads?: BrowserDownloadItem[]
      find?: BrowserFindResult
      documentRevision?: number
      sitePermissions?: BrowserSitePermissions
      windows?: { id: number; title: string }[]
      movedTabs?: { key: string; tab: BrowserWorkspaceTab }[]
      /** HTTP(S) new-tab requests from a workspace browser view, drained by `status`. */
      openedLinks?: string[]
      /**
       * Native pages opened by a website or extension. Adopt each with `show` using its key and
       * exact URL. Website pages include their opener key for temporary previews.
       * Drained by any `status` in the window.
       */
      createdTabs?: {
        key: string
        url: string
        profileId: string
        active?: boolean
        openerKey?: string
      }[]
      /** Keys of tabs an extension closed in this window; drained by any `status` in the window. */
      closedTabs?: string[]
      /** Pending media requests in this window; a snapshot, repeated until answered or expired. */
      mediaRequests?: BrowserMediaRequest[]
      /** Ongoing tab captures in this window; a snapshot, repeated while they run. */
      captures?: BrowserCapture[]
      /** Teams tabs, active sharing recipients and native video PiP in this Studio window. */
      callTabs?: BrowserCallTab[]
      /** Exact existing tab to select after a native focus request; consumed only by status. */
      focusedTabKey?: string
      protectedKeys?: string[]
      back: boolean
      forward: boolean
    }
  | undefined
>

/** Private desktop discovery for task-scoped, page-only CDP endpoints. */
export const desktopBrowserHostSchema = mutableStruct({
  pid: Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
  targets: mutableArray(
    mutableStruct({
      taskId: Schema.String,
      profileId: Schema.String,
      endpoint: Schema.String.pipe(
        Schema.check(
          Schema.isPattern(/^ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/devtools\/page\/\d+$/),
        ),
      ),
    }),
  ),
})

/** Paired-user browser workspace; never accepted by agent or device endpoints as a task. */
export const STUDIO_BROWSER_SCOPE = 'studio:browser'
export const browserSelectionSchema = mutableStruct({
  text: maxValue(Schema.String, 32000),
  url: Schema.String,
  title: Schema.String,
})
/** Read literal page text only; never interpolate page content into executable code. */
export function selectedBrowserText() {
  const element = document.activeElement
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    // Password, hidden and other non-text controls expose masks or nothing useful.
    if (
      element instanceof HTMLInputElement &&
      !['text', 'search', 'url', 'email', 'tel'].includes(element.type)
    )
      return ''
    return element.value
      .slice(element.selectionStart ?? 0, element.selectionEnd ?? 0)
      .slice(0, 32000)
  }
  return (window.getSelection()?.toString() ?? '').slice(0, 32000)
}

const browserProfileIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,100}$/)),
)
const browserExtensionIdSchema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-p]{32}$/)))
const browserPixelSchema = (minimum: number) =>
  maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isInt())), minimum), 10000)
/** Local shared-browser profiles only; extension code and filesystem paths never come from the renderer. */
export const browserExtensionCommandSchema = Schema.Union([
  mutableStruct({
    action: Schema.Literal('installStore'),
    profileId: browserProfileIdSchema,
    url: maxValue(minValue(Schema.String, 1), 4096),
  }),
  mutableStruct({
    action: Schema.Literals(['list', 'install']),
    profileId: browserProfileIdSchema,
  }),
  mutableStruct({
    action: Schema.Literals(['enable', 'disable', 'remove', 'pin', 'unpin']),
    profileId: browserProfileIdSchema,
    id: browserExtensionIdSchema,
  }),
  mutableStruct({
    action: Schema.Literal('open'),
    profileId: browserProfileIdSchema,
    id: browserExtensionIdSchema,
    /** Browser tab key of the active shared-browser tab, as used by `BrowserCommand`. */
    key: maxValue(minValue(Schema.String, 1), 500),
    /** Toolbar button bounds in window content coordinates, like `show` bounds. */
    anchor: mutableStruct({
      x: browserPixelSchema(0),
      y: browserPixelSchema(0),
      width: browserPixelSchema(1),
      height: browserPixelSchema(1),
    }),
  }),
])
export type BrowserExtensionCommand = Schema.Schema.Type<typeof browserExtensionCommandSchema>
export type BrowserExtension = {
  id: string
  name: string
  version: string
  enabled: boolean
  pinned?: boolean
  /** Enabled and running in this profile now. */
  loaded: boolean
  title?: string
  /** PNG data URL from the managed copy. */
  icon?: string
  /** Clicking opens an action popup rather than sending `action.onClicked`. */
  popup: boolean
  /** Requested permissions Dovo does not provide; related features may fail. */
  unsupportedPermissions: string[]
  /** Permissions removed from a managed copy by an older Dovo release. Reinstall to review access. */
  removedPermissions: string[]
  error?: string
}
export type BrowserExtensionsResult = {
  extensions: BrowserExtension[]
  /** Set by `install` on success; absent when the user cancelled the folder picker. */
  installed?: string
  capabilities: {
    unpackedFolders: true
    nativeMessaging: boolean
    chromeWebStore: boolean
    remoteRuntimes: false
  }
}
export type BrowserExtensionBridge = (
  command: BrowserExtensionCommand,
) => Promise<BrowserExtensionsResult | undefined>

export const browserContextActionSchema = mutableStruct({
  key: maxValue(minValue(Schema.String, 1), 500),
  action: Schema.Literals(['selection', 'page', 'find', 'close-find']),
  text: maxValue(Schema.String, 32000),
  url: maxValue(Schema.String, 4096),
  title: maxValue(Schema.String, 500),
})
export type BrowserContextAction = Schema.Schema.Type<typeof browserContextActionSchema>

export type DefaultBrowserStatus = { supported: boolean; isDefault: boolean }
export interface DefaultBrowserBridge {
  status: () => Promise<DefaultBrowserStatus>
  request: () => Promise<void>
}
