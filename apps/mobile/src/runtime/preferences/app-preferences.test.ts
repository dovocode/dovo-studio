import { expect, it, vi } from 'vite-plus/test'

const storage = vi.hoisted(() => {
  const state: {
    getItem: () => Promise<string | null>
    setItem: (value: string) => Promise<void>
  } = {
    getItem: async () => null,
    setItem: async () => {},
  }
  return state
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: () => storage.getItem(),
    setItem: (_key: string, value: string) => storage.setItem(value),
  },
}))

async function loadPreferences() {
  vi.resetModules()
  return import('./app-preferences')
}

it('preserves unread settings through failed hydration and merges pending edits on retry', async () => {
  const saved = JSON.stringify({ taskSort: 'title', carMode: true })
  const writes: string[] = []
  storage.getItem = async () => {
    throw new Error('Storage temporarily unavailable')
  }
  storage.setItem = async (value) => {
    writes.push(value)
  }
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const preferences = await loadPreferences()
    await preferences.preferencesReady
    preferences.updateMobilePreferences({ keepScreenOn: true })
    await preferences.loadMobilePreferences()
    expect(writes).toEqual([])
    storage.getItem = async () => saved
    await preferences.loadMobilePreferences()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(JSON.parse(writes[0])).toMatchObject({
      taskSort: 'title',
      carMode: true,
      keepScreenOn: true,
    })
  } finally {
    warning.mockRestore()
  }
})

it('keeps an edit made while saved preferences are still loading', async () => {
  let resolveGet: (value: string) => void = () => {}
  storage.getItem = () =>
    new Promise((resolve) => {
      resolveGet = resolve
    })
  const writes: string[] = []
  storage.setItem = async (value) => {
    writes.push(value)
  }
  const preferences = await loadPreferences()
  preferences.updateMobilePreferences({ keepScreenOn: true })
  expect(preferences.readMobilePreferences().keepScreenOn).toBe(true)
  resolveGet(JSON.stringify({ carMode: true, taskSort: 'title' }))
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences()).toMatchObject({
    carMode: true,
    taskSort: 'title',
    keepScreenOn: true,
    launchTab: 'tasks',
    speechRate: 1.25,
  })
  await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0))
  expect(JSON.parse(writes.at(-1) ?? '{}')).toMatchObject({
    carMode: true,
    taskSort: 'title',
    keepScreenOn: true,
  })
})

it('persists the latest preferences when saves overlap', async () => {
  storage.getItem = async () => null
  const writes: string[] = []
  let calls = 0
  let release: () => void = () => {}
  storage.setItem = (value) => {
    calls++
    if (calls === 1)
      return new Promise((resolve) => {
        release = () => {
          writes.push(value)
          resolve()
        }
      })
    writes.push(value)
    return Promise.resolve()
  }
  const preferences = await loadPreferences()
  await preferences.preferencesReady
  preferences.updateMobilePreferences({ taskSort: 'title' })
  preferences.updateMobilePreferences({ taskSort: 'oldest' })
  await vi.waitFor(() => expect(calls).toBe(1))
  release()
  await vi.waitFor(() => expect(writes.length).toBe(2))
  expect(JSON.parse(writes.at(-1) ?? '{}').taskSort).toBe('oldest')
})

it('hides finished subagents by default and remembers showing their history', async () => {
  storage.getItem = async () => JSON.stringify({ taskSort: 'title' })
  let saved = ''
  storage.setItem = async (value) => {
    saved = value
  }
  const preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences().hideFinishedSubagents).toBe(true)
  preferences.updateMobilePreferences({ hideFinishedSubagents: false })
  await vi.waitFor(() => expect(saved).not.toBe(''))
  storage.getItem = async () => saved
  const reopened = await loadPreferences()
  await reopened.preferencesReady
  expect(reopened.readMobilePreferences()).toMatchObject({
    hideFinishedSubagents: false,
    taskSort: 'title',
  })
})

it('defaults changed files to collapsed and restores an expanded preference', async () => {
  storage.getItem = async () => JSON.stringify({ taskSort: 'title' })
  const first = await loadPreferences()
  await first.preferencesReady
  expect(first.readMobilePreferences().collapseChangedFiles).toBe(true)
  expect(first.readMobilePreferences().showToolDetails).toBe(false)
  let saved = ''
  storage.setItem = async (value) => {
    saved = value
  }
  first.updateMobilePreferences({ collapseChangedFiles: false, showToolDetails: true })
  await vi.waitFor(() => expect(saved).not.toBe(''))
  storage.getItem = async () => saved
  const reopened = await loadPreferences()
  await reopened.preferencesReady
  expect(reopened.readMobilePreferences()).toMatchObject({
    collapseChangedFiles: false,
    showToolDetails: true,
    taskSort: 'title',
  })
})

it('restores battery choices independently and preserves defaults for older or invalid records', async () => {
  storage.getItem = async () =>
    JSON.stringify({ computerRefresh: 'obsolete', widgetUpdates: false, taskSort: 'title' })
  let saved = ''
  storage.setItem = async (value) => {
    saved = value
  }
  const preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences()).toMatchObject({
    computerRefresh: 'normal',
    widgetUpdates: false,
    taskSort: 'title',
  })
  preferences.updateMobilePreferences({ computerRefresh: 'manual', widgetUpdates: true })
  await vi.waitFor(() => expect(saved).not.toBe(''))
  storage.getItem = async () => saved
  const reopened = await loadPreferences()
  await reopened.preferencesReady
  expect(reopened.readMobilePreferences()).toMatchObject({
    computerRefresh: 'manual',
    widgetUpdates: true,
    taskSort: 'title',
  })
})

it('merges shared scope edits with offline cached scopes that arrive during preference hydration', async () => {
  let resolveGet: (value: string) => void = () => {}
  storage.getItem = () =>
    new Promise((resolve) => {
      resolveGet = resolve
    })
  storage.setItem = async () => {}
  const preferences = await loadPreferences()
  const shared = { key: 'global', updatedAt: 2, changeId: 'new', value: {} }
  preferences.updateMobilePreferences({ sharedScopedSettings: [shared] })
  resolveGet(
    JSON.stringify({
      sharedScopedSettings: [
        {
          key: 'global',
          updatedAt: 1,
          changeId: 'old',
          value: { taskDefaults: { setupCommand: 'old' } },
        },
        {
          key: 'project:github.com/team/repo',
          updatedAt: 1,
          changeId: 'project',
          value: { taskDefaults: { setupCommand: 'project' } },
        },
      ],
    }),
  )
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences().sharedScopedSettings).toEqual([
    shared,
    {
      key: 'project:github.com/team/repo',
      updatedAt: 1,
      changeId: 'project',
      value: { taskDefaults: { setupCommand: 'project' } },
    },
  ])
})

it('keeps Working optional and restores the saved choice', async () => {
  storage.getItem = async () => JSON.stringify({ taskSort: 'title' })
  storage.setItem = async () => {}
  let preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences().workingSection).toBe(false)
  preferences.updateMobilePreferences({ workingSection: true })
  expect(preferences.readMobilePreferences().workingSection).toBe(true)

  storage.getItem = async () => JSON.stringify({ workingSection: true, taskSort: 'title' })
  preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences()).toMatchObject({
    workingSection: true,
    taskSort: 'title',
  })
})

it('migrates older font settings, rejects invalid values and persists Nerd Font choices', async () => {
  storage.getItem = async () =>
    JSON.stringify({ theme: 'light', terminalFontFamily: 'not bundled', terminalFontSize: 100 })
  let saved = ''
  storage.setItem = async (value) => {
    saved = value
  }
  const preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences()).toMatchObject({
    theme: 'light',
    terminalFontFamily: '',
    terminalFontSize: 12,
  })
  preferences.updateMobilePreferences({
    terminalFontFamily: 'JetBrains Mono Nerd Font',
    terminalFontSize: 18,
  })
  await vi.waitFor(() => expect(saved).not.toBe(''))
  storage.getItem = async () => saved
  const reopened = await loadPreferences()
  await reopened.preferencesReady
  expect(reopened.readMobilePreferences()).toMatchObject({
    theme: 'light',
    terminalFontFamily: 'JetBrains Mono Nerd Font',
    terminalFontSize: 18,
  })
})

it('restores complete section orders and falls back for invalid orders', async () => {
  const order = ['waiting', 'working', 'active', 'pinned', 'snoozed', 'settled']
  storage.getItem = async () => JSON.stringify({ threadSectionOrder: order })
  let preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences().threadSectionOrder).toEqual(order)
  const writes: string[] = []
  storage.setItem = async (value) => {
    writes.push(value)
  }
  preferences.updateMobilePreferences({
    threadSectionOrder: ['settled', 'waiting', 'working', 'active', 'pinned', 'snoozed'],
  })
  await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0))
  expect(JSON.parse(writes.at(-1) ?? '{}').threadSectionOrder[0]).toBe('settled')
  storage.getItem = async () => JSON.stringify({ threadSectionOrder: ['waiting'], theme: 'light' })
  preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences()).toMatchObject({
    theme: 'light',
    threadSectionOrder: ['pinned', 'active', 'working', 'waiting', 'snoozed', 'settled'],
  })
})

it('restores section collapse choices across phone restarts independently of list items', async () => {
  let saved: string | null = null
  storage.getItem = async () => saved
  storage.setItem = async (value) => {
    saved = value
  }
  const first = await loadPreferences()
  await first.preferencesReady
  first.updateMobilePreferences({ collapsedThreadSections: ['waiting', 'settled'] })
  await vi.waitFor(() => expect(saved).not.toBeNull())
  const restarted = await loadPreferences()
  await restarted.preferencesReady
  expect(restarted.readMobilePreferences().collapsedThreadSections).toEqual(['waiting', 'settled'])
  restarted.updateMobilePreferences({ collapsedThreadSections: [] })
  await vi.waitFor(() => expect(JSON.parse(saved ?? '{}').collapsedThreadSections).toEqual([]))
  const expanded = await loadPreferences()
  await expanded.preferencesReady
  expect(expanded.readMobilePreferences().collapsedThreadSections).toEqual([])
})

it.each([undefined, 'obsolete'])(
  'defaults thread density safely for saved value %s and persists both layouts',
  async (threadDensity) => {
    let saved = JSON.stringify({ threadDensity, taskSort: 'title' })
    storage.getItem = async () => saved
    storage.setItem = async (value) => {
      saved = value
    }
    let preferences = await loadPreferences()
    await preferences.preferencesReady
    expect(preferences.readMobilePreferences()).toMatchObject({
      threadDensity: 'compact',
      taskSort: 'title',
    })
    for (const density of ['comfortable', 'compact'] as const) {
      preferences.updateMobilePreferences({ threadDensity: density })
      await vi.waitFor(() => expect(JSON.parse(saved).threadDensity).toBe(density))
      preferences = await loadPreferences()
      await preferences.preferencesReady
      expect(preferences.readMobilePreferences()).toMatchObject({
        threadDensity: density,
        taskSort: 'title',
      })
    }
  },
)

it('restores accessibility choices independently and keeps older saved settings', async () => {
  storage.getItem = async () =>
    JSON.stringify({
      themePalette: 'iris',
      motion: 'unknown',
      highContrast: 'yes',
      colorVision: 'unknown',
    })
  const saved: string[] = []
  storage.setItem = async (value) => {
    saved.push(value)
  }
  const preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences()).toMatchObject({
    themePalette: 'iris',
    motion: 'system',
    highContrast: false,
    colorVision: 'default',
  })
  preferences.updateMobilePreferences({
    highContrast: true,
    colorVision: 'blue-orange',
    motion: 'reduce',
  })
  await vi.waitFor(() => expect(saved).toHaveLength(1))
  storage.getItem = async () => saved[0]
  const restored = await loadPreferences()
  await restored.preferencesReady
  expect(restored.readMobilePreferences()).toMatchObject({
    themePalette: 'iris',
    motion: 'reduce',
    highContrast: true,
    colorVision: 'blue-orange',
  })
})

it('keeps Browser experimental and disabled until this device opts in', async () => {
  let saved: string | null = null
  storage.getItem = async () => saved
  storage.setItem = async (value) => {
    saved = value
  }
  const preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences().browserWorkspaceEnabled).toBe(false)
  preferences.updateMobilePreferences({ browserWorkspaceEnabled: true })
  await vi.waitFor(() => expect(JSON.parse(saved ?? '{}').browserWorkspaceEnabled).toBe(true))
  const reopened = await loadPreferences()
  await reopened.preferencesReady
  expect(reopened.readMobilePreferences().browserWorkspaceEnabled).toBe(true)
})

it('defaults both cleanup timers off and persists each timer independently on this device', async () => {
  let saved: string | null = null
  storage.getItem = async () => saved
  storage.setItem = async (value) => {
    saved = value
  }
  const preferences = await loadPreferences()
  await preferences.preferencesReady
  expect(preferences.readMobilePreferences()).toMatchObject({
    browserAutoSettleMinutes: 0,
    browserCloseSettledMinutes: 0,
  })
  preferences.updateMobilePreferences({
    browserAutoSettleMinutes: 45,
    browserCloseSettledMinutes: 120,
  })
  await vi.waitFor(() =>
    expect(JSON.parse(saved ?? '{}')).toMatchObject({
      browserAutoSettleMinutes: 45,
      browserCloseSettledMinutes: 120,
    }),
  )
  const reopened = await loadPreferences()
  await reopened.preferencesReady
  expect(reopened.readMobilePreferences()).toMatchObject({
    browserAutoSettleMinutes: 45,
    browserCloseSettledMinutes: 120,
  })
})
