import { afterEach, expect, it, vi } from 'vitest'

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
    threadSidebarWidth: 280,
    toolsSidebarWidth: 420,
    sendWith: 'enter',
    textSize: 'default',
    collapseChangedFiles: true,
  })
})

it('moves desktop preferences from browser storage to the settings bridge', async () => {
  const local = storage({ 'dovo.app-preferences.v1': JSON.stringify({ theme: 'light' }) })
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
  expect(saved).toMatchObject({ theme: 'light', textSize: 'large' })
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
  updateAppPreferences({ collapseChangedFiles: false })
  vi.resetModules()
  const { readAppPreferences } = await import('./preferences')
  expect(readAppPreferences().collapseChangedFiles).toBe(false)
})
