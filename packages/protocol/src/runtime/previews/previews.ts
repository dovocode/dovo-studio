import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { minValue, maxValue, urlSchema } from '../../shared/schema.js'
import { Schema } from 'effect'
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
export const browserCommandSchema = Schema.Union([
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
    action: Schema.Literals([
      'hide',
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
    ]),
    key: maxValue(minValue(Schema.String, 1), 500),
  }),
  /** Answer a pending `mediaRequests` entry; only shared-browser tabs ever create one. */
  mutableStruct({
    action: Schema.Literal('media'),
    /** Tab key of the requesting page, as listed in the request. */
    key: maxValue(minValue(Schema.String, 1), 500),
    requestId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f-]{36}$/))),
    decision: Schema.Literals(['allow', 'deny']),
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
  kind: 'display' | 'user-media'
  /** Requesting tab key and profile. */
  key: string
  profileId: string
  /** Origin of the requesting page, e.g. `https://meet.google.com`. */
  origin: string
  video: boolean
  audio: boolean
  /** Epoch milliseconds; afterwards the request is denied automatically. */
  expiresAt: number
  /** Display requests: shareable tabs in the same window and profile, never thread previews. */
  sources?: { key: string; title: string; url: string; requester: boolean }[]
}
/** A tab being captured. Listed until its tracks really end, never just because Stop was asked. */
export type BrowserCapture = {
  id: string
  /** Tab key of the page that receives the capture. */
  key: string
  /** Tab key of the tab being shared. */
  sourceKey: string
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
export type BrowserBridge = (command: BrowserCommand) => Promise<
  | {
      url: string
      title?: string
      cdp?: string
      image?: string
      selection?: string
      /** HTTP(S) new-tab requests from a workspace browser view, drained by `status`. */
      openedLinks?: string[]
      /**
       * Hidden tabs an extension opened in this window. Adopt each with `show` using its key and
       * exact URL; drained by any `status` in the window.
       */
      createdTabs?: { key: string; url: string; profileId: string }[]
      /** Keys of tabs an extension closed in this window; drained by any `status` in the window. */
      closedTabs?: string[]
      /** Pending media requests in this window; a snapshot, repeated until answered or expired. */
      mediaRequests?: BrowserMediaRequest[]
      /** Ongoing tab captures in this window; a snapshot, repeated while they run. */
      captures?: BrowserCapture[]
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
/** Local shared-browser profiles only; extension code and paths never come from the renderer. */
export const browserExtensionCommandSchema = Schema.Union([
  mutableStruct({
    action: Schema.Literals(['list', 'install']),
    profileId: browserProfileIdSchema,
  }),
  mutableStruct({
    action: Schema.Literals(['enable', 'disable', 'remove']),
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
  /** Enabled and running in this profile now. */
  loaded: boolean
  title?: string
  /** PNG data URL from the managed copy. */
  icon?: string
  /** Clicking opens an action popup rather than sending `action.onClicked`. */
  popup: boolean
  /** Requested permissions Dovo does not provide; related features may fail. */
  unsupportedPermissions: string[]
  /** Permissions removed from Dovo's managed copy, such as `nativeMessaging`. */
  removedPermissions: string[]
  error?: string
}
export type BrowserExtensionsResult = {
  extensions: BrowserExtension[]
  /** Set by `install` on success; absent when the user cancelled the folder picker. */
  installed?: string
  capabilities: {
    unpackedFolders: true
    nativeMessaging: false
    chromeWebStore: false
    remoteRuntimes: false
  }
}
export type BrowserExtensionBridge = (
  command: BrowserExtensionCommand,
) => Promise<BrowserExtensionsResult | undefined>
