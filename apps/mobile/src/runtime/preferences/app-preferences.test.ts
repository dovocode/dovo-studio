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
