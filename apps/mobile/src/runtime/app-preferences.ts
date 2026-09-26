import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Schema } from 'effect'
import { decodeResult, mutableStruct } from '@dovo/protocol'

/** Settings → General on this phone only. Never synced to computers. */
const schema = mutableStruct({
  taskSort: Schema.Literal('priority', 'activity', 'newest', 'oldest', 'title', 'project'),
  confirmArchive: Schema.Boolean,
  confirmStop: Schema.Boolean,
  launchTab: Schema.Literal('tasks', 'issues', 'pulls', 'jobs'),
  timeFormat: Schema.Literal('auto', '12h', '24h'),
  toolActivity: Schema.Literal('collapsed', 'expanded'),
  mergeMethod: Schema.Literal('auto', 'merge', 'squash', 'rebase'),
  pullDraft: Schema.Boolean,
  keepScreenOn: Schema.Boolean,
  carMode: Schema.Boolean,
})
export type MobilePreferences = Schema.Schema.Type<typeof schema>
const defaults: MobilePreferences = {
  taskSort: 'priority',
  confirmArchive: false,
  confirmStop: false,
  launchTab: 'tasks',
  timeFormat: 'auto',
  toolActivity: 'collapsed',
  mergeMethod: 'auto',
  pullDraft: false,
  keepScreenOn: false,
  carMode: false,
}
const key = 'dovo.mobile-preferences.v1'
let current = defaults
let loaded = false
const listeners = new Set<() => void>()
const publish = () => listeners.forEach((listener) => listener())

/** Resolves once saved preferences are read, so cold-start choices (launch tab, sort) apply. */
export const preferencesReady = AsyncStorage.getItem(key)
  .then((raw) => {
    const saved: unknown = raw ? JSON.parse(raw) : {}
    const record = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
    // Field by field: one outdated value never resets the rest.
    const merged: Record<string, unknown> = { ...defaults }
    for (const field of Object.keys(defaults))
      if (field in record && decodeResult(schema, { ...defaults, [field]: record[field] }).success)
        merged[field] = record[field]
    const result = decodeResult(schema, merged)
    if (result.success) current = result.data
  })
  .catch(() => undefined)
  .finally(() => {
    loaded = true
    publish()
  })

export const readMobilePreferences = () => current
export function updateMobilePreferences(changes: Partial<MobilePreferences>) {
  current = { ...current, ...changes }
  publish()
  void AsyncStorage.setItem(key, JSON.stringify(current)).catch(() => undefined)
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
