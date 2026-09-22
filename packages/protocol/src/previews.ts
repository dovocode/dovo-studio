import { z } from 'zod'

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
  { id: 'fill', name: 'Fit window', width: 0, height: 0 },
  { id: 'phone', name: 'Phone · 390 × 844', width: 390, height: 844 },
  { id: 'tablet', name: 'Tablet · 820 × 1180', width: 820, height: 1180 },
  { id: 'desktop', name: 'Desktop · 1440 × 900', width: 1440, height: 900 },
] as const
export const previewDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['simulator', 'physical']).optional(),
  connection: z.string().optional(),
  liveSupported: z.boolean().optional(),
  platform: z.enum(['ios', 'android']),
  state: z.enum(['booted', 'stopped', 'starting']),
  runtime: z.string(),
})
export type PreviewDevice = z.infer<typeof previewDeviceSchema>
export const previewDevicesSchema = z.object({
  host: z.string(),
  devices: z.array(previewDeviceSchema),
  diagnostics: z.array(z.string()),
})
export const previewActionSchema = z.object({
  taskId: z.string().min(1).max(200),
  id: z.string().min(1).max(200),
  action: z.enum([
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
  ]),
  url: z.string().max(4096).optional(),
  bundleId: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/)
    .optional(),
})
export const previewResultSchema = z.object({
  ok: z.literal(true),
  image: z.string().optional(),
  apps: z.array(z.object({ name: z.string(), bundleId: z.string() })).optional(),
})
export const browserCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('external'), key: z.string().min(1).max(500), url: z.url() }),
  z.object({
    action: z.literal('show'),
    key: z.string().min(1).max(500),
    url: z.url(),
    viewport: z
      .object({
        width: z.number().int().min(1).max(2000),
        height: z.number().int().min(1).max(2000),
      })
      .optional(),
    bounds: z.object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      width: z.number().int().min(1).max(5000),
      height: z.number().int().min(1).max(5000),
    }),
  }),
  z.object({
    action: z.enum(['hide', 'back', 'forward', 'reload', 'status']),
    key: z.string().min(1).max(500),
  }),
])
export type BrowserCommand = z.infer<typeof browserCommandSchema>
export type BrowserBridge = (
  command: BrowserCommand,
) => Promise<{ url: string; back: boolean; forward: boolean } | undefined>
