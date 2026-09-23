import { mutableStruct, mutableArray } from './schema.js'
import { minValue, maxValue, urlSchema } from './schema.js'
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
  kind: Schema.optional(Schema.Literal('simulator', 'physical')),
  connection: Schema.optional(Schema.String),
  liveSupported: Schema.optional(Schema.Boolean),
  platform: Schema.Literal('ios', 'android'),
  state: Schema.Literal('booted', 'stopped', 'starting'),
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
  id: maxValue(minValue(Schema.String, 1), 200),
  action: Schema.Literal(
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
  ),
  url: Schema.optional(maxValue(Schema.String, 4096)),
  bundleId: Schema.optional(
    maxValue(minValue(Schema.String, 1), 255).pipe(Schema.pattern(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/)),
  ),
})
export const previewResultSchema = mutableStruct({
  ok: Schema.Literal(true),
  image: Schema.optional(Schema.String),
  apps: Schema.optional(
    mutableArray(
      mutableStruct({
        name: Schema.String,
        bundleId: Schema.String,
      }),
    ),
  ),
})
export const browserCommandSchema = Schema.Union(
  ...[
    mutableStruct({
      action: Schema.Literal('external'),
      key: maxValue(minValue(Schema.String, 1), 500),
      url: urlSchema(),
    }),
    mutableStruct({
      action: Schema.Literal('show'),
      key: maxValue(minValue(Schema.String, 1), 500),
      url: urlSchema(),
      viewport: Schema.optional(
        mutableStruct({
          width: maxValue(
            minValue(
              Schema.Number.pipe(Schema.finite()).pipe(
                Schema.int(),
                Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
              ),
              1,
            ),
            2000,
          ),
          height: maxValue(
            minValue(
              Schema.Number.pipe(Schema.finite()).pipe(
                Schema.int(),
                Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
              ),
              1,
            ),
            2000,
          ),
        }),
      ),
      bounds: mutableStruct({
        x: minValue(
          Schema.Number.pipe(Schema.finite()).pipe(
            Schema.int(),
            Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
          ),
          0,
        ),
        y: minValue(
          Schema.Number.pipe(Schema.finite()).pipe(
            Schema.int(),
            Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
          ),
          0,
        ),
        width: maxValue(
          minValue(
            Schema.Number.pipe(Schema.finite()).pipe(
              Schema.int(),
              Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
            ),
            1,
          ),
          5000,
        ),
        height: maxValue(
          minValue(
            Schema.Number.pipe(Schema.finite()).pipe(
              Schema.int(),
              Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
            ),
            1,
          ),
          5000,
        ),
      }),
    }),
    mutableStruct({
      action: Schema.Literal('hide', 'back', 'forward', 'reload', 'status'),
      key: maxValue(minValue(Schema.String, 1), 500),
    }),
  ],
)
export type BrowserCommand = Schema.Schema.Type<typeof browserCommandSchema>
export type BrowserBridge = (command: BrowserCommand) => Promise<
  | {
      url: string
      back: boolean
      forward: boolean
    }
  | undefined
>
