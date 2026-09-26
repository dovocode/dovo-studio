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
    values,
  }
}

it('keeps valid saved choices, fills in new defaults and ignores invalid values', async () => {
  vi.stubGlobal(
    'localStorage',
    storage({ 'dovo.app-preferences.v1': JSON.stringify({ theme: 'light', sendWith: 'bogus' }) }),
  )
  const { readAppPreferences } = await import('./preferences')
  // The invalid field falls back alone; the valid saved theme survives.
  expect(readAppPreferences()).toMatchObject({
    theme: 'light',
    sendWith: 'enter',
    textSize: 'default',
  })
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
