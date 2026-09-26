import { useMemo, useSyncExternalStore } from 'react'
import { Schema } from 'effect'
import { decodeResult, mutableStruct } from '@dovo/protocol'

/** Preferences for this app window only (like Codex and T3 Code "General" and "Appearance").
 * They never sync to computers; each device keeps its own. */
const schema = mutableStruct({
  theme: Schema.Literal('dark', 'light', 'system'),
  textSize: Schema.Literal('small', 'default', 'large'),
  sendWith: Schema.Literal('enter', 'mod-enter'),
  followUp: Schema.Literal('queue', 'steer'),
  confirmArchive: Schema.Boolean,
  confirmStop: Schema.Boolean,
  notifyInput: Schema.Boolean,
  notifyDone: Schema.Boolean,
  notifyAutomations: Schema.Boolean,
  launchView: Schema.Literal('tasks', 'overview'),
  diffLayout: Schema.Literal('unified', 'split'),
  diffOverflow: Schema.Literal('wrap', 'scroll'),
  diffHighlight: Schema.Literal('word', 'char', 'none'),
  diffLineNumbers: Schema.Boolean,
  timeFormat: Schema.Literal('auto', '12h', '24h'),
  notifySound: Schema.Boolean,
  motion: Schema.Literal('system', 'reduce'),
  taskSort: Schema.Literal('priority', 'activity', 'newest', 'oldest', 'title', 'project'),
  toolActivity: Schema.Literal('collapsed', 'expanded'),
  mergeMethod: Schema.Literal('auto', 'merge', 'squash', 'rebase'),
  pullDraft: Schema.Boolean,
  browserViewport: Schema.Literal('fill', 'phone', 'tablet', 'desktop'),
})
export type AppPreferences = Schema.Schema.Type<typeof schema>
export const defaultAppPreferences: AppPreferences = {
  theme: 'dark',
  textSize: 'default',
  sendWith: 'enter',
  followUp: 'queue',
  confirmArchive: false,
  confirmStop: false,
  notifyInput: false,
  notifyDone: false,
  notifyAutomations: false,
  launchView: 'tasks',
  diffLayout: 'unified',
  diffOverflow: 'wrap',
  diffHighlight: 'word',
  diffLineNumbers: true,
  timeFormat: 'auto',
  notifySound: true,
  motion: 'system',
  taskSort: 'priority',
  toolActivity: 'collapsed',
  mergeMethod: 'auto',
  pullDraft: false,
  browserViewport: 'fill',
}
const key = 'dovo.app-preferences.v1'
const listeners = new Set<() => void>()
let cached: AppPreferences | undefined

export function readAppPreferences(): AppPreferences {
  if (cached) return cached
  let stored: unknown
  try {
    stored = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null')
  } catch {
    stored = null
  }
  // Validate field by field: one bad or renamed value falls back alone instead of resetting
  // every preference, and fields added in later versions start at their defaults.
  const saved = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const merged: Record<string, unknown> = { ...defaultAppPreferences }
  for (const field of Object.keys(defaultAppPreferences)) {
    if (!(field in saved)) continue
    const candidate = { ...defaultAppPreferences, [field]: saved[field] }
    if (decodeResult(schema, candidate).success) merged[field] = saved[field]
  }
  const result = decodeResult(schema, merged)
  cached = result.success ? result.data : defaultAppPreferences
  return cached
}
export function updateAppPreferences(changes: Partial<AppPreferences>) {
  cached = { ...readAppPreferences(), ...changes }
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(cached))
  } catch {
    // Private or full storage: keep the choice for this session.
  }
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another window of the app changed a preference.
  const storage = (event: StorageEvent) => {
    if (event.key !== key) return
    cached = undefined
    listener()
  }
  globalThis.addEventListener?.('storage', storage)
  return () => {
    listeners.delete(listener)
    globalThis.removeEventListener?.('storage', storage)
  }
}
export function useAppPreferences() {
  return useSyncExternalStore(subscribe, readAppPreferences, () => defaultAppPreferences)
}

/** The theme actually shown: "system" resolved against the OS, updating live. */
export function useResolvedTheme(): 'dark' | 'light' {
  const { theme } = useAppPreferences()
  const system = useSyncExternalStore(
    (listener) => {
      const media = globalThis.matchMedia?.('(prefers-color-scheme: light)')
      media?.addEventListener('change', listener)
      return () => media?.removeEventListener('change', listener)
    },
    () => (globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
    () => 'dark' as const,
  )
  return theme === 'system' ? system : theme
}

/** Settings → Diffs, as options for the Pierre diff renderer. */
export function useDiffOptions() {
  const { diffOverflow, diffHighlight, diffLineNumbers, diffLayout } = useAppPreferences()
  const theme = useResolvedTheme()
  // Stable identity: diff views memoize on these options and re-render when they change.
  return useMemo(
    () =>
      ({
        defaultSplit: diffLayout === 'split',
        options: {
          theme: theme === 'light' ? 'pierre-light' : 'pierre-dark',
          themeType: theme,
          overflow: diffOverflow,
          lineDiffType: diffHighlight,
          disableLineNumbers: !diffLineNumbers,
        },
      }) as const,
    [diffOverflow, diffHighlight, diffLineNumbers, diffLayout, theme],
  )
}

/** Dates and times in the user's chosen clock (Settings → General → Time format). */
export function formatDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
) {
  const { timeFormat } = readAppPreferences()
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleString(undefined, {
    ...options,
    ...(timeFormat === 'auto' ? {} : { hour12: timeFormat === '12h' }),
  })
}
