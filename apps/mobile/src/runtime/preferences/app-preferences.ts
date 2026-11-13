import { botLayoutSchema, mcpRegistrySourceSchema } from '@dovo/protocol'
import {
  pullProjectVisibilitySchema,
  defaultTaskSnoozeMinutes,
  taskSnoozeMinutesSchema,
  defaultTaskSnoozeSchedule,
  taskSnoozeScheduleSchema,
} from '@dovo/protocol'
import { defaultThreadSectionOrder, threadSectionOrderSchema } from '@dovo/protocol'
import { serviceUrlsSchema } from '@dovo/protocol'
import { mergeSharedSettings, sharedSettingsSchema } from '@dovo/protocol'
import { nerdFontFamily, terminalFontSizeSchema } from '@dovo/studio-core/fonts'
import { studioThemeIds } from '@dovo/studio-core/themes'
import { codeThemeSchema, importedCodeThemesSchema } from '@dovo/studio-core/code-themes'
import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Schema } from 'effect'
import {
  modelPreferencesSchema,
  agentPresetSchema,
  mutableArray,
  decodeResult,
  mutableStruct,
  browserTabCleanupSettingsFields,
  browserProfilesSchema,
} from '@dovo/protocol'

/** Local preferences for this phone. Never synced to computers. */
const schema = mutableStruct({
  ...serviceUrlsSchema.fields,
  motion: Schema.Literals(['system', 'reduce']),
  theme: Schema.Literals(['system', 'light', 'dark']),
  terminalFontFamily: Schema.Literals(['', nerdFontFamily]),
  terminalFontSize: terminalFontSizeSchema,
  themePalette: Schema.Literals([...studioThemeIds]),
  colorVision: Schema.Literals(['default', 'blue-orange']),
  highContrast: Schema.Boolean,
  codeTheme: codeThemeSchema,
  importedCodeThemes: importedCodeThemesSchema,
  sharedScopedSettings: sharedSettingsSchema,
  globalModelPreferencesUpdatedAt: Schema.Number,
  globalModelPreferences: Schema.NullOr(modelPreferencesSchema),
  globalAgentPresets: mutableArray(agentPresetSchema),
  retiredGlobalAgentPresets: mutableArray(Schema.String),
  threadDensity: Schema.Literals(['compact', 'comfortable']),
  taskSort: Schema.Literals(['priority', 'activity', 'newest', 'oldest', 'title', 'project']),
  botLayout: botLayoutSchema,
  botsInThreads: Schema.Boolean,
  mcpRegistrySource: mcpRegistrySourceSchema,
  botsOverviewEnabled: Schema.Boolean,
  taskGrouping: Schema.Literals(['none', 'status', 'project']),
  hideFinishedSubagents: Schema.Boolean,
  workingSection: Schema.Boolean,
  collapsedThreadSections: mutableArray(Schema.String),
  threadSectionOrder: threadSectionOrderSchema,
  taskSnoozeMinutes: taskSnoozeMinutesSchema,
  taskSnoozeSchedule: taskSnoozeScheduleSchema,
  threadInfoOrder: mutableArray(Schema.String),
  threadInfoSections: Schema.Record(Schema.String, Schema.Boolean),
  confirmArchive: Schema.Boolean,
  confirmStop: Schema.Boolean,
  launchTab: Schema.Literals(['tasks', 'issues', 'pulls', 'jobs']),
  timeFormat: Schema.Literals(['auto', '12h', '24h']),
  collapseChangedFiles: Schema.Boolean,
  showToolDetails: Schema.Boolean,
  showContextUsage: Schema.Boolean,
  minimalComposer: Schema.Boolean,
  showPlanButton: Schema.Boolean,
  toolActivity: Schema.Literals(['collapsed', 'expanded']),
  mergeMethod: Schema.Literals(['auto', 'merge', 'squash', 'rebase']),
  pullDraft: Schema.Boolean,
  pullProjectVisibility: pullProjectVisibilitySchema,
  keepScreenOn: Schema.Boolean,
  browserWorkspaceEnabled: Schema.Boolean,
  terminalWorkspaceEnabled: Schema.Boolean,
  unifiedWorkspaceEnabled: Schema.Boolean,
  unifiedWorkspaceActive: Schema.Boolean,
  hideNormalWorkspaceModes: Schema.Boolean,
  browserProfiles: browserProfilesSchema,
  ...browserTabCleanupSettingsFields,
  computerRefresh: Schema.Literals(['normal', 'reduced', 'manual']),
  widgetUpdates: Schema.Boolean,
  carMode: Schema.Boolean,
  readRepliesAloud: Schema.Boolean,
  runtimeDictationIds: Schema.Array(Schema.String),
  dictationLanguage: Schema.String,
  speechLanguage: Schema.String,
  speechVoice: Schema.String,
  speechRate: Schema.Literals([1, 1.25, 1.5, 1.75, 2]),
})
export type MobilePreferences = Schema.Schema.Type<typeof schema>
const defaults: MobilePreferences = {
  connectOrigin: '',
  artifactsOrigin: '',
  motion: 'system',
  theme: 'dark',
  themePalette: 'dovo',
  colorVision: 'default',
  highContrast: false,
  codeTheme: 'app',
  importedCodeThemes: [],
  terminalFontFamily: '',
  terminalFontSize: 12,
  sharedScopedSettings: [],
  globalModelPreferencesUpdatedAt: 0,
  globalModelPreferences: null,
  globalAgentPresets: [],
  retiredGlobalAgentPresets: [],
  threadDensity: 'compact',
  botLayout: 'horizontal',
  botsInThreads: true,
  mcpRegistrySource: 'official',
  botsOverviewEnabled: false,
  taskSort: 'priority',
  taskGrouping: 'none',
  hideFinishedSubagents: true,
  workingSection: false,
  collapsedThreadSections: ['working', 'snoozed', 'settled'],
  threadSectionOrder: [...defaultThreadSectionOrder],
  taskSnoozeMinutes: [...defaultTaskSnoozeMinutes],
  taskSnoozeSchedule: {
    ...defaultTaskSnoozeSchedule,
    presets: [...defaultTaskSnoozeSchedule.presets],
  },
  threadInfoOrder: [],
  threadInfoSections: {},
  confirmArchive: false,
  confirmStop: false,
  launchTab: 'tasks',
  timeFormat: 'auto',
  collapseChangedFiles: true,
  showToolDetails: false,
  showContextUsage: true,
  minimalComposer: true,
  showPlanButton: false,
  toolActivity: 'collapsed',
  mergeMethod: 'auto',
  pullDraft: false,
  pullProjectVisibility: {},
  keepScreenOn: false,
  browserWorkspaceEnabled: false,
  terminalWorkspaceEnabled: true,
  unifiedWorkspaceEnabled: false,
  unifiedWorkspaceActive: false,
  hideNormalWorkspaceModes: false,
  browserProfiles: [
    { id: 'default', name: 'Default' },
    { id: 'device', name: 'Device' },
  ],
  browserAutoSettleMinutes: 0,
  browserCloseSettledMinutes: 0,
  computerRefresh: 'reduced',
  widgetUpdates: true,
  carMode: false,
  readRepliesAloud: true,
  runtimeDictationIds: [],
  dictationLanguage: '',
  speechLanguage: '',
  speechVoice: '',
  speechRate: 1.25,
}
const key = 'dovo.mobile-preferences.v1'
let current = defaults
// Retain fields written by a newer app without exposing unvalidated values to callers.
let unknownPreferences: Record<string, unknown> = {}
let loaded = false
let loading: Promise<void> | undefined
// Edits that arrive before the saved record is read. Applied on top of it so a
// fast toggle cannot be overwritten, or itself overwrite the rest of the record.
let edits: Partial<MobilePreferences> | undefined
// A section toggle before hydration changes only that section, not the unread saved list.
const sectionEdits = new Map<string, boolean>()
// Overlapping setItem calls are not ordered. A slow older save must not finish last.
let persistQueue = Promise.resolve()
let revision = 0
let storageStatus = { pending: false, error: null as string | null }
export const readMobilePreferenceStorage = () => storageStatus
const setStorageStatus = (pending: boolean, error: string | null) => {
  storageStatus = { pending, error }
  publish()
}
const listeners = new Set<() => void>()
const publish = () => listeners.forEach((listener) => listener())
const enqueuePersist = () => {
  if (!edits) return persistQueue
  setStorageStatus(true, storageStatus.error)
  persistQueue = persistQueue.then(async () => {
    if (!edits) return
    const savingRevision = revision
    try {
      await AsyncStorage.setItem(key, JSON.stringify({ ...unknownPreferences, ...current }))
      if (savingRevision === revision) {
        edits = undefined
        setStorageStatus(false, null)
      }
    } catch {
      setStorageStatus(
        true,
        'Could not save preferences on this phone. Changes are only available until the app closes.',
      )
    }
  })
  return persistQueue
}
export async function retryMobilePreferences(): Promise<void> {
  await loadMobilePreferences()
  if (!loaded) throw new Error(storageStatus.error ?? 'Could not load saved preferences')
  await enqueuePersist()
  if (storageStatus.error) throw new Error(storageStatus.error)
}
function restoredPreferences(raw: string | null): MobilePreferences {
  const saved: unknown = raw ? JSON.parse(raw) : {}
  const record = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
  unknownPreferences = Object.fromEntries(
    Object.entries(record).filter(([field]) => !Object.hasOwn(defaults, field)),
  )
  // Field by field: one outdated value never resets the rest.
  const merged: Record<string, unknown> = { ...defaults }
  for (const field of Object.keys(defaults))
    if (field in record && decodeResult(schema, { ...defaults, [field]: record[field] }).success)
      merged[field] = record[field]
  const result = decodeResult(schema, merged)
  return result.success ? result.data : defaults
}

/** Failed reads preserve pending edits and can be retried without overwriting unread settings. */
export function loadMobilePreferences(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (loading) return loading
  loading = AsyncStorage.getItem(key)
    .then((raw) => {
      const restored = restoredPreferences(raw)
      const changed = !!edits || sectionEdits.size > 0
      current = edits
        ? {
            ...restored,
            ...edits,
            sharedScopedSettings: mergeSharedSettings(
              restored.sharedScopedSettings,
              edits.sharedScopedSettings ?? [],
            ),
          }
        : restored
      if (sectionEdits.size) {
        const collapsed = new Set(current.collapsedThreadSections)
        for (const [section, value] of sectionEdits) {
          if (value) collapsed.add(section)
          else collapsed.delete(section)
        }
        current = { ...current, collapsedThreadSections: [...collapsed] }
        sectionEdits.clear()
      }
      loaded = true
      if (changed) edits = { ...edits, collapsedThreadSections: current.collapsedThreadSections }
      setStorageStatus(!!edits, null)
      if (edits) void enqueuePersist()
    })
    .catch(() => {
      setStorageStatus(
        !!edits,
        'Could not load preferences on this phone. Saved settings have been preserved; retry to load them and save any changes.',
      )
    })
    .finally(() => {
      loading = undefined
      publish()
    })
  return loading
}

/** Resolves after the initial read attempt; defaults remain usable if storage is unavailable. */
export const preferencesReady = loadMobilePreferences()

export const readMobilePreferences = () => current
export function updateMobilePreferences(changes: Partial<MobilePreferences>) {
  if (changes.collapsedThreadSections !== undefined) sectionEdits.clear()
  updatePreferences(changes)
}
function updatePreferences(changes: Partial<MobilePreferences>) {
  revision++
  edits = { ...edits, ...changes }
  current = { ...current, ...changes }
  publish()
  if (loaded) void enqueuePersist()
  else void loadMobilePreferences()
}

/** Apply an explicit section choice to the latest state, including delayed cold-start reads. */
export function setMobileThreadSectionCollapsed(section: string, value: boolean) {
  const collapsed = new Set(current.collapsedThreadSections)
  if (value) collapsed.add(section)
  else collapsed.delete(section)
  if (!loaded) {
    sectionEdits.set(section, value)
    // Keep full-list replacements separate from per-section edits during hydration.
    current = { ...current, collapsedThreadSections: [...collapsed] }
    publish()
    void loadMobilePreferences()
  } else updatePreferences({ collapsedThreadSections: [...collapsed] })
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function useMobilePreferenceStorage() {
  return useSyncExternalStore(subscribe, readMobilePreferenceStorage)
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
