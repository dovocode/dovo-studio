import { afterEach, expect, it, vi } from 'vite-plus/test'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})
const storage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  }
}

it('keeps valid saved choices, fills in new defaults and ignores invalid values', async () => {
  vi.stubGlobal(
    'localStorage',
    storage({
      'dovo.app-preferences.v1': JSON.stringify({
        theme: 'light',
        projectPanelOpen: true,
        launchView: 'overview',
        lastThreadId: 'saved-thread',
        sendWith: 'bogus',
        threadSidebarWidth: -10,
        toolsSidebarWidth: 420,
      }),
    }),
  )
  const { readAppPreferences } = await import('./preferences')
  // The invalid field falls back alone; the valid saved theme survives.
  expect(readAppPreferences()).toMatchObject({
    theme: 'light',
    projectPanelOpen: true,
    themePalette: 'dovo',
    lastThreadId: 'saved-thread',
    threadSidebarWidth: 280,
    toolsSidebarWidth: 420,
    sendWith: 'enter',
    textSize: 'default',
    collapseChangedFiles: true,
    browserAutoSettleMinutes: 0,
    browserCloseSettledMinutes: 0,
    browserLinkOpening: 'preview',
  })
  expect(readAppPreferences()).not.toHaveProperty('launchView')
})

it('moves desktop preferences from browser storage to the settings bridge', async () => {
  const local = storage({
    'dovo.app-preferences.v1': JSON.stringify({ theme: 'light', themePalette: 'claude' }),
  })
  vi.stubGlobal('localStorage', local)
  let saved: unknown = null
  vi.stubGlobal('dovo', {
    readAppSettings: () => saved,
    writeAppSettings: (value: string) => {
      saved = JSON.parse(value)
    },
  })
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences().theme).toBe('light')
  expect(local.values.has('dovo.app-preferences.v1')).toBe(false)
  updateAppPreferences({ textSize: 'large' })
  expect(saved).toMatchObject({ theme: 'light', themePalette: 'claude', textSize: 'large' })
})

it('persists updates and notifies subscribers', async () => {
  const local = storage()
  vi.stubGlobal('localStorage', local)
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  updateAppPreferences({ textSize: 'large', notifyDone: true, browserLinkOpening: 'tab' })
  expect(readAppPreferences()).toMatchObject({ textSize: 'large', notifyDone: true, theme: 'dark' })
  expect(JSON.parse(local.values.get('dovo.app-preferences.v1') ?? '{}')).toMatchObject({
    textSize: 'large',
    browserLinkOpening: 'tab',
  })
})

it('hides finished subagents by default and remembers showing their history', async () => {
  vi.stubGlobal('localStorage', storage())
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences().hideFinishedSubagents).toBe(true)
  updateAppPreferences({ hideFinishedSubagents: false })
  vi.resetModules()
  const reopened = await import('./preferences')
  expect(reopened.readAppPreferences().hideFinishedSubagents).toBe(false)
})

it('restores Thread Info customization across restarts and resets it independently', async () => {
  const local = storage()
  vi.stubGlobal('localStorage', local)
  const preferences = await import('./preferences')
  preferences.updateAppPreferences({
    threadInfoSections: { usage: false, scripts: false },
    theme: 'light',
  })
  vi.resetModules()
  const reopened = await import('./preferences')
  expect(reopened.readAppPreferences().threadInfoSections).toEqual({ usage: false, scripts: false })
  reopened.updateAppPreferences({ threadInfoSections: {} })
  expect(reopened.readAppPreferences().theme).toBe('light')
  vi.resetModules()
  expect((await import('./preferences')).readAppPreferences().threadInfoSections).toEqual({})
})

it('persists a palette independently of color scheme and restores it on reopening', async () => {
  vi.stubGlobal('localStorage', storage())
  const { updateAppPreferences } = await import('./preferences')
  updateAppPreferences({ themePalette: 'vscode', theme: 'system' })
  updateAppPreferences({ theme: 'light' })
  vi.resetModules()
  const { readAppPreferences } = await import('./preferences')
  expect(readAppPreferences()).toMatchObject({ themePalette: 'vscode', theme: 'light' })
})

it('falls back from an unknown palette without losing other saved preferences', async () => {
  vi.stubGlobal(
    'localStorage',
    storage({
      'dovo.app-preferences.v1': JSON.stringify({
        themePalette: 'removed',
        theme: 'system',
        textSize: 'large',
      }),
    }),
  )
  const { readAppPreferences } = await import('./preferences')
  expect(readAppPreferences()).toMatchObject({
    themePalette: 'dovo',
    theme: 'system',
    textSize: 'large',
  })
})

it.each(['showContextUsage', 'minimalComposer'] as const)(
  'persists %s independently',
  async (key) => {
    vi.stubGlobal('localStorage', storage())
    const { readAppPreferences, updateAppPreferences } = await import('./preferences')
    expect(readAppPreferences()[key]).toBe(true)
    updateAppPreferences({ [key]: false })
    vi.resetModules()
    const reopened = await import('./preferences')
    expect(reopened.readAppPreferences()[key]).toBe(false)
    reopened.updateAppPreferences({ [key]: true })
    expect(reopened.readAppPreferences()[key]).toBe(true)
  },
)

it('persists glow intensity and gradients independently of the palette', async () => {
  const local = storage()
  vi.stubGlobal('localStorage', local)
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences()).toMatchObject({ themeGlow: 0.5, themeGradients: true })
  updateAppPreferences({ themeGlow: 0.35, themeGradients: false, themePalette: 'iris' })
  vi.resetModules()
  const reopened = await import('./preferences')
  expect(reopened.readAppPreferences()).toMatchObject({
    themeGlow: 0.35,
    themeGradients: false,
    themePalette: 'iris',
  })
  reopened.updateAppPreferences({ themePalette: 'dovo' })
  expect(reopened.readAppPreferences()).toMatchObject({ themeGlow: 0.35, themeGradients: false })
})

it.each([0, 1, -0.1, 1.1])('validates saved glow intensity %s', async (themeGlow) => {
  vi.stubGlobal(
    'localStorage',
    storage({
      'dovo.app-preferences.v1': JSON.stringify({ themeGlow }),
    }),
  )
  const { readAppPreferences } = await import('./preferences')
  expect(readAppPreferences().themeGlow).toBe(themeGlow < 0 || themeGlow > 1 ? 0.5 : themeGlow)
})

it('preserves the previous effects-off preference', async () => {
  vi.stubGlobal(
    'localStorage',
    storage({
      'dovo.app-preferences.v1': JSON.stringify({ themeEffects: false }),
    }),
  )
  const { readAppPreferences } = await import('./preferences')
  expect(readAppPreferences()).toMatchObject({ themeGlow: 0, themeGradients: false })
})

it('persists browser profiles, per-thread selections and opt-in agent access', async () => {
  const local = storage()
  vi.stubGlobal('localStorage', local)
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences().browserProfiles).toEqual([{ id: 'default', name: 'Default' }])
  updateAppPreferences({
    browserProfiles: [
      { id: 'default', name: 'Default' },
      { id: 'work', name: 'Work' },
    ],
    browserProfileByThread: { thread: 'work' },
    browserAgentAccess: { thread: true },
  })
  vi.resetModules()
  const reopened = await import('./preferences')
  expect(reopened.readAppPreferences()).toMatchObject({
    browserProfiles: [
      { id: 'default', name: 'Default' },
      { id: 'work', name: 'Work' },
    ],
    browserProfileByThread: { thread: 'work' },
    browserAgentAccess: { thread: true },
  })
})

it('keeps the changed-files expansion preference across reopening', async () => {
  vi.stubGlobal('localStorage', storage())
  const { updateAppPreferences } = await import('./preferences')
  expect((await import('./preferences')).readAppPreferences().showToolDetails).toBe(false)
  updateAppPreferences({ collapseChangedFiles: false, showToolDetails: true })
  vi.resetModules()
  const { readAppPreferences } = await import('./preferences')
  expect(readAppPreferences().collapseChangedFiles).toBe(false)
  expect(readAppPreferences().showToolDetails).toBe(true)
})

it('restores independent fonts and terminal size without losing older preferences', async () => {
  vi.stubGlobal('localStorage', storage())
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences()).toMatchObject({
    appFontFamily: '',
    codeFontFamily: '',
    terminalFontFamily: '',
    terminalFontSize: 12,
  })
  updateAppPreferences({
    appFontFamily: 'Georgia',
    codeFontFamily: 'Fira Code',
    terminalFontFamily: 'JetBrains Mono Nerd Font',
    terminalFontSize: 18,
  })
  vi.resetModules()
  const reopened = await import('./preferences')
  expect(reopened.readAppPreferences()).toMatchObject({
    appFontFamily: 'Georgia',
    codeFontFamily: 'Fira Code',
    terminalFontFamily: 'JetBrains Mono Nerd Font',
    terminalFontSize: 18,
  })
})

it.each([0, 33, 12.5, '18', null])(
  'rejects invalid saved terminal size %s independently',
  async (terminalFontSize) => {
    vi.stubGlobal(
      'localStorage',
      storage({
        'dovo.app-preferences.v1': JSON.stringify({
          theme: 'light',
          terminalFontSize,
          appFontFamily: 'Georgia',
          codeFontFamily: 'invalid\nfont',
          terminalFontFamily: 'x'.repeat(101),
        }),
      }),
    )
    const { readAppPreferences } = await import('./preferences')
    expect(readAppPreferences()).toMatchObject({
      theme: 'light',
      terminalFontSize: 12,
      appFontFamily: 'Georgia',
      codeFontFamily: '',
      terminalFontFamily: '',
    })
  },
)

it('restores section ordering across sessions and rejects incomplete saved orders', async () => {
  const saved = storage()
  vi.stubGlobal('localStorage', saved)
  const preferences = await import('./preferences')
  const order = ['waiting', 'working', 'active', 'pinned', 'snoozed', 'settled'] as const
  preferences.updateAppPreferences({ threadSectionOrder: [...order] })
  vi.resetModules()
  expect((await import('./preferences')).readAppPreferences().threadSectionOrder).toEqual(order)
  saved.setItem(
    'dovo.app-preferences.v1',
    JSON.stringify({ threadSectionOrder: ['waiting'], theme: 'light' }),
  )
  vi.resetModules()
  expect((await import('./preferences')).readAppPreferences()).toMatchObject({
    theme: 'light',
    threadSectionOrder: ['pinned', 'active', 'working', 'waiting', 'snoozed', 'settled'],
  })
})

it('restores section collapse choices across restarts without depending on list items', async () => {
  vi.stubGlobal('localStorage', storage())
  const first = await import('./preferences')
  first.updateAppPreferences({ collapsedThreadSections: ['waiting', 'settled'] })
  vi.resetModules()
  const restarted = await import('./preferences')
  expect(restarted.readAppPreferences().collapsedThreadSections).toEqual(['waiting', 'settled'])
  restarted.updateAppPreferences({ collapsedThreadSections: [] })
  vi.resetModules()
  expect((await import('./preferences')).readAppPreferences().collapsedThreadSections).toEqual([])
})

it('keeps dictation opt-in and persists its language independently', async () => {
  vi.stubGlobal('localStorage', storage())
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences()).toMatchObject({ dictationEnabled: false, dictationLanguage: 'auto' })
  updateAppPreferences({ dictationEnabled: true, dictationLanguage: 'nl-NL' })
  vi.resetModules()
  expect((await import('./preferences')).readAppPreferences()).toMatchObject({
    dictationEnabled: true,
    dictationLanguage: 'nl-NL',
  })
})

it('restores accessibility settings without losing existing choices', async () => {
  const local = storage()
  vi.stubGlobal('localStorage', local)
  const preferences = await import('./preferences')
  expect(preferences.readAppPreferences()).toMatchObject({
    colorVision: 'default',
    highContrast: false,
    motion: 'system',
  })
  preferences.updateAppPreferences({
    colorVision: 'blue-orange',
    highContrast: true,
    motion: 'reduce',
    themePalette: 'iris',
  })
  vi.resetModules()
  expect((await import('./preferences')).readAppPreferences()).toMatchObject({
    colorVision: 'blue-orange',
    highContrast: true,
    motion: 'reduce',
    themePalette: 'iris',
  })
})

it('honors Reduce motion for scroll actions from either Dovo or the OS', async () => {
  vi.stubGlobal('localStorage', storage())
  let system = false
  vi.stubGlobal('matchMedia', () => ({ matches: system }))
  const { reducedMotion, updateAppPreferences } = await import('./preferences')
  expect(reducedMotion()).toBe(false)
  system = true
  expect(reducedMotion()).toBe(true)
  system = false
  updateAppPreferences({ motion: 'reduce' })
  expect(reducedMotion()).toBe(true)
})

it('falls back from invalid accessibility values independently', async () => {
  vi.stubGlobal(
    'localStorage',
    storage({
      'dovo.app-preferences.v1': JSON.stringify({
        colorVision: 'unknown',
        highContrast: 'yes',
        motion: 'always',
        theme: 'light',
      }),
    }),
  )
  expect((await import('./preferences')).readAppPreferences()).toMatchObject({
    colorVision: 'default',
    highContrast: false,
    motion: 'system',
    theme: 'light',
  })
})

it('keeps the experimental Browser disabled until explicitly enabled', async () => {
  const saved = storage()
  vi.stubGlobal('localStorage', saved)
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences().browserWorkspaceEnabled).toBe(false)
  updateAppPreferences({ browserWorkspaceEnabled: true })
  expect(readAppPreferences().browserWorkspaceEnabled).toBe(true)
  expect(JSON.parse(saved.getItem('dovo.app-preferences.v1')!).browserWorkspaceEnabled).toBe(true)
  updateAppPreferences({ browserWorkspaceEnabled: false })
  expect(readAppPreferences().browserWorkspaceEnabled).toBe(false)
})

it('merges desktop updates with the latest settings from another window', async () => {
  let saved: Record<string, unknown> = { theme: 'dark', browserWorkspaceEnabled: false }
  vi.stubGlobal('dovo', {
    readAppSettings: () => saved,
    writeAppSettings: (value: string) => {
      saved = JSON.parse(value)
    },
  })
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences().browserWorkspaceEnabled).toBe(false)
  // Another window writes before its asynchronous change event arrives here.
  saved = { ...saved, browserWorkspaceEnabled: true }
  updateAppPreferences({ textSize: 'large' })
  expect(saved).toMatchObject({ browserWorkspaceEnabled: true, textSize: 'large' })
})

it('defaults to activity sorting and remembers manual sorting across reloads', async () => {
  vi.stubGlobal('localStorage', storage())
  const { readAppPreferences, updateAppPreferences } = await import('./preferences')
  expect(readAppPreferences().browserSortByActivity).toBe(true)
  updateAppPreferences({ browserSortByActivity: false })
  vi.resetModules()
  const reopened = await import('./preferences')
  expect(reopened.readAppPreferences().browserSortByActivity).toBe(false)
})
