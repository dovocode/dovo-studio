import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Schema } from 'effect'
import {
  modelPreferencesSchema,
  agentPresetSchema,
  mutableArray,
  decodeResult,
  mutableStruct,
} from '@dovo/protocol'

/** Settings → General on this phone only. Never synced to computers. */
const schema = mutableStruct({
  globalModelPreferencesUpdatedAt: Schema.Number,
  globalModelPreferences: Schema.NullOr(modelPreferencesSchema),
  globalAgentPresets: mutableArray(agentPresetSchema),
  retiredGlobalAgentPresets: mutableArray(Schema.String),
  taskSort: Schema.Literal('priority', 'activity', 'newest', 'oldest', 'title', 'project'),
  taskGrouping: Schema.Literal('none', 'status', 'project'),
  confirmArchive: Schema.Boolean,
  confirmStop: Schema.Boolean,
  launchTab: Schema.Literal('tasks', 'issues', 'pulls', 'jobs'),
  timeFormat: Schema.Literal('auto', '12h', '24h'),
  collapseChangedFiles: Schema.Boolean,
  showToolDetails: Schema.Boolean,
  toolActivity: Schema.Literal('collapsed', 'expanded'),
  mergeMethod: Schema.Literal('auto', 'merge', 'squash', 'rebase'),
  pullDraft: Schema.Boolean,
  keepScreenOn: Schema.Boolean,
  carMode: Schema.Boolean,
  readRepliesAloud: Schema.Boolean,
  dictationLanguage: Schema.String,
  speechLanguage: Schema.String,
  speechVoice: Schema.String,
  speechRate: Schema.Literal(1, 1.25, 1.5, 1.75, 2),
})
export type MobilePreferences = Schema.Schema.Type<typeof schema>
const defaults: MobilePreferences = {
  globalModelPreferencesUpdatedAt: 0,
  globalModelPreferences: null,
  globalAgentPresets: [],
  retiredGlobalAgentPresets: [],
  taskSort: 'priority',
  taskGrouping: 'none',
  confirmArchive: false,
  confirmStop: false,
  launchTab: 'tasks',
  timeFormat: 'auto',
  collapseChangedFiles: true,
  showToolDetails: false,
  toolActivity: 'collapsed',
  mergeMethod: 'auto',
  pullDraft: false,
  keepScreenOn: false,
  carMode: false,
  readRepliesAloud: true,
  dictationLanguage: '',
  speechLanguage: '',
  speechVoice: '',
  speechRate: 1.25,
}
const key = 'dovo.mobile-preferences.v1'
let current = defaults
let loaded = false
// Edits that arrive before the saved record is read. Applied on top of it so a
// fast toggle cannot be overwritten, or itself overwrite the rest of the record.
let edits: Partial<MobilePreferences> | undefined
// Overlapping setItem calls are not ordered. A slow older save must not finish last.
let persistQueue = Promise.resolve()
const listeners = new Set<() => void>()
const publish = () => listeners.forEach((listener) => listener())
const enqueuePersist = () => {
  persistQueue = persistQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(key, JSON.stringify(current)))
    .catch(() => undefined)
}
function restoredPreferences(raw: string | null): MobilePreferences {
  const saved: unknown = raw ? JSON.parse(raw) : {}
  const record = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
  // Field by field: one outdated value never resets the rest.
  const merged: Record<string, unknown> = { ...defaults }
  for (const field of Object.keys(defaults))
    if (field in record && decodeResult(schema, { ...defaults, [field]: record[field] }).success)
      merged[field] = record[field]
  const result = decodeResult(schema, merged)
  return result.success ? result.data : defaults
}

/** Resolves once saved preferences are read, so cold-start choices (launch tab, sort) apply. */
export const preferencesReady = AsyncStorage.getItem(key)
  .then((raw) => {
    const restored = restoredPreferences(raw)
    current = edits ? { ...restored, ...edits } : restored
  })
  .catch(() => undefined)
  .finally(() => {
    loaded = true
    if (edits) enqueuePersist()
    publish()
  })

export const readMobilePreferences = () => current
export function updateMobilePreferences(changes: Partial<MobilePreferences>) {
  edits = { ...edits, ...changes }
  current = { ...current, ...changes }
  publish()
  if (loaded) enqueuePersist()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
/** Settings → General → Car mode: larger text and a calmer, glanceable app. */
export const carZoom = 1.3
export function useCarMode() {
  return useSyncExternalStore(subscribe, () => current.carMode)
}
export function useMobilePreferences() {
  const preferences = useSyncExternalStore(subscribe, () => current)
  const ready = useSyncExternalStore(subscribe, () => loaded)
  return { ...preferences, ready }
}

/** Times in the chosen clock (Settings → General → Time format). */
export function formatTime(date: Date, options: Intl.DateTimeFormatOptions = {}) {
  const { timeFormat } = current
  return date.toLocaleTimeString([], {
    ...options,
    ...(timeFormat === 'auto' ? {} : { hour12: timeFormat === '12h' }),
  })
}
