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
    themePalette: 'dovo',
    lastThreadId: 'saved-thread',
    threadSidebarWidth: 280,
    toolsSidebarWidth: 420,
    sendWith: 'enter',
    textSize: 'default',
    collapseChangedFiles: true,
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
  updateAppPreferences({ textSize: 'large', notifyDone: true })
  expect(readAppPreferences()).toMatchObject({ textSize: 'large', notifyDone: true, theme: 'dark' })
  expect(JSON.parse(local.values.get('dovo.app-preferences.v1') ?? '{}')).toMatchObject({
    textSize: 'large',
  })
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
