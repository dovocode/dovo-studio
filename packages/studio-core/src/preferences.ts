import { sharedSettingsSchema } from '@dovo/protocol'
import { useMemo, useSyncExternalStore } from 'react'
import { Schema } from 'effect'
import { fontFamilySchema, terminalFontSizeSchema } from './fonts'
import { studioThemeIds, studioSyntaxTheme, studioThemes } from './themes'
import {
  modelPreferencesSchema,
  agentPresetSchema,
  decodeResult,
  mutableStruct,
  mutableArray,
  browserProfilesSchema,
  defaultBrowserProfiles,
} from '@dovo/protocol'

/** Preferences for this app window only (like Codex and T3 Code "General" and "Appearance").
 * They never sync to computers; each device keeps its own. */
const schema = mutableStruct({
  sharedScopedSettings: sharedSettingsSchema,
  globalModelPreferencesUpdatedAt: Schema.Number,
  globalModelPreferences: Schema.NullOr(modelPreferencesSchema),
  globalAgentPresets: mutableArray(agentPresetSchema),
  retiredGlobalAgentPresets: mutableArray(Schema.String),
  projectGrouping: Schema.Boolean,
  workingSection: Schema.Boolean,
  projectOrder: Schema.Literals(['name', 'activity', 'user-message']),
  inAppNotifications: Schema.Boolean,
  responseStreaming: Schema.Literals(['live', 'paragraphs']),
  showSkillsInSlashMenu: Schema.Boolean,
  markdownComposerPreview: Schema.Boolean,
  collapseComposerOnScroll: Schema.Boolean,
  hideWhitespaceChanges: Schema.Boolean,
  proactivePanels: Schema.Boolean,
  confirmUnpin: Schema.Boolean,
  confirmDelete: Schema.Boolean,
  addProjectStartsIn: Schema.String,
  providerUpdateChecks: Schema.Boolean,
  backgroundActivity: Schema.Literals(['balanced', 'reduced']),
  quitShortcut: Schema.Literals(['immediate', 'hold', 'disabled']),
  theme: Schema.Literals(['dark', 'light', 'system']),
  themePalette: Schema.Literals([...studioThemeIds]),
  appFontFamily: fontFamilySchema,
  codeFontFamily: fontFamilySchema,
  terminalFontFamily: fontFamilySchema,
  terminalFontSize: terminalFontSizeSchema,
  textSize: Schema.Literals(['small', 'default', 'large']),
  sendWith: Schema.Literals(['enter', 'mod-enter']),
  followUp: Schema.Literals(['queue', 'steer']),
  confirmArchive: Schema.Boolean,
  confirmStop: Schema.Boolean,
  notifyInput: Schema.Boolean,
  inputPreview: Schema.Boolean,
  taskLauncherShortcut: Schema.Literals([
    'CommandOrControl+Shift+Space',
    'CommandOrControl+Alt+N',
    '',
  ]),
  notifyDone: Schema.Boolean,
  notifyAutomations: Schema.Boolean,
  lastThreadId: Schema.NullOr(Schema.String),
  showIssues: Schema.Boolean,
  showJira: Schema.Boolean,
  diffLayout: Schema.Literals(['unified', 'split']),
  diffOverflow: Schema.Literals(['wrap', 'scroll']),
  diffHighlight: Schema.Literals(['word', 'char', 'none']),
  diffLineNumbers: Schema.Boolean,
  collapseChangedFiles: Schema.Boolean,
  timeFormat: Schema.Literals(['auto', '12h', '24h']),
  notifySound: Schema.Boolean,
  motion: Schema.Literals(['system', 'reduce']),
  taskSort: Schema.Literals(['priority', 'activity', 'newest', 'oldest', 'title', 'project']),
  taskGrouping: Schema.Literals(['none', 'status', 'project']),
  hideFinishedSubagents: Schema.Boolean,
  showToolDetails: Schema.Boolean,
  toolActivity: Schema.Literals(['collapsed', 'expanded', 'hidden']),
  threadSidebarWidth: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isBetween({ minimum: 180, maximum: 640 })),
  ),
  toolsSidebarWidth: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isBetween({ minimum: 180, maximum: 960 })),
  ),
  viewerSidebarWidth: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isBetween({ minimum: 180, maximum: 960 })),
  ),
  diffFilesSidebarWidth: Schema.Number.pipe(
    Schema.check(Schema.isFinite()),
    Schema.check(Schema.isBetween({ minimum: 180, maximum: 640 })),
  ),
  chatWidth: Schema.Literals(['standard', 'wide', 'full']),
  mergeMethod: Schema.Literals(['auto', 'merge', 'squash', 'rebase']),
  pullDraft: Schema.Boolean,
  browserProfiles: browserProfilesSchema,
  // Legacy initial-tab default; new profile selections belong to individual tabs.
  browserProfileByThread: Schema.Record(Schema.String, Schema.String),
  browserAgentAccess: Schema.Record(Schema.String, Schema.Boolean),
  browserViewport: Schema.Literals(['fill', 'phone', 'tablet', 'desktop']),
})
export type AppPreferences = Schema.Schema.Type<typeof schema>
export const defaultAppPreferences: AppPreferences = {
  sharedScopedSettings: [],
  globalModelPreferencesUpdatedAt: 0,
  globalModelPreferences: null,
  globalAgentPresets: [],
  retiredGlobalAgentPresets: [],
  projectGrouping: true,
  workingSection: false,
  projectOrder: 'name',
  inAppNotifications: true,
  responseStreaming: 'live',
  showSkillsInSlashMenu: true,
  markdownComposerPreview: false,
  collapseComposerOnScroll: false,
  hideWhitespaceChanges: false,
  proactivePanels: false,
  confirmUnpin: false,
  confirmDelete: true,
  addProjectStartsIn: '',
  providerUpdateChecks: true,
  backgroundActivity: 'balanced',
  quitShortcut: 'immediate',
  theme: 'dark',
  themePalette: 'dovo',
  appFontFamily: '',
  codeFontFamily: '',
  terminalFontFamily: '',
  terminalFontSize: 12,
  textSize: 'default',
  sendWith: 'enter',
  followUp: 'queue',
  confirmArchive: false,
  confirmStop: false,
  notifyInput: false,
  inputPreview: false,
  taskLauncherShortcut: 'CommandOrControl+Shift+Space',
  notifyDone: false,
  notifyAutomations: false,
  lastThreadId: null,
  showIssues: true,
  showJira: true,
  diffLayout: 'unified',
  diffOverflow: 'wrap',
  diffHighlight: 'word',
  diffLineNumbers: true,
  collapseChangedFiles: true,
  timeFormat: 'auto',
  notifySound: true,
  motion: 'system',
  taskSort: 'priority',
  taskGrouping: 'status',
  hideFinishedSubagents: true,
  showToolDetails: false,
  toolActivity: 'collapsed',
  threadSidebarWidth: 280,
  toolsSidebarWidth: 380,
  viewerSidebarWidth: 560,
  diffFilesSidebarWidth: 256,
  chatWidth: 'standard',
  mergeMethod: 'auto',
  pullDraft: false,
  browserProfiles: defaultBrowserProfiles(),
  browserProfileByThread: {},
  browserAgentAccess: {},
  browserViewport: 'fill',
}
const key = 'dovo.app-preferences.v1'
const desktopSettingsBridge = mutableStruct({
  dovo: mutableStruct({
    readAppSettings: Schema.Unknown.pipe(
      Schema.refine((value): value is () => unknown => typeof value === 'function'),
    ),
    writeAppSettings: Schema.Unknown.pipe(
      Schema.refine((value): value is (value: string) => void => typeof value === 'function'),
    ),
  }),
})
const listeners = new Set<() => void>()
let cached: AppPreferences | undefined

export function readAppPreferences(): AppPreferences {
  if (cached) return cached
  let stored: unknown
  let migrateLegacy = false
  const bridge = decodeResult(desktopSettingsBridge, globalThis)
  try {
    stored = bridge.success
      ? bridge.data.dovo.readAppSettings()
      : JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null')
  } catch {
    stored = null
  }
  if (bridge.success && stored === null) {
    try {
      const legacy = globalThis.localStorage?.getItem(key)
      if (legacy) {
        stored = JSON.parse(legacy)
        migrateLegacy = true
      }
    } catch {
      // Keep the legacy value available for a later migration attempt.
    }
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
  if (migrateLegacy && bridge.success) {
    try {
      bridge.data.dovo.writeAppSettings(JSON.stringify(cached))
      globalThis.localStorage?.removeItem(key)
    } catch {
      // Keep the old value available for the next launch.
    }
  }
  return cached
}
export function updateAppPreferences(changes: Partial<AppPreferences>) {
  cached = { ...readAppPreferences(), ...changes }
  const bridge = decodeResult(desktopSettingsBridge, globalThis)
  try {
    if (bridge.success) bridge.data.dovo.writeAppSettings(JSON.stringify(cached))
    else globalThis.localStorage?.setItem(key, JSON.stringify(cached))
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

export function useStudioTheme() {
  const { themePalette } = useAppPreferences()
  const mode = useResolvedTheme()
  return studioThemes[themePalette][mode]
}

/** Settings → Diffs, as options for the Pierre diff renderer. */
export function useDiffOptions() {
  const { diffOverflow, diffHighlight, diffLineNumbers, diffLayout, themePalette } =
    useAppPreferences()
  const theme = useResolvedTheme()
  // Stable identity: diff views memoize on these options and re-render when they change.
  return useMemo(
    () =>
      ({
        defaultSplit: diffLayout === 'split',
        options: {
          theme: studioSyntaxTheme(themePalette, theme).name,
          themeType: theme,
          overflow: diffOverflow,
          lineDiffType: diffHighlight,
          disableLineNumbers: !diffLineNumbers,
        },
      }) as const,
    [diffOverflow, diffHighlight, diffLineNumbers, diffLayout, theme, themePalette],
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
