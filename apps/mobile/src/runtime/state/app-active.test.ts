import { beforeEach, expect, it, vi } from 'vite-plus/test'

const appState = vi.hoisted(() => ({
  currentState: 'active' as string,
  listeners: new Set<(state: string) => void>(),
  emit(state: string) {
    appState.currentState = state
    for (const listener of appState.listeners) listener(state)
  },
}))
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return appState.currentState
    },
    addEventListener: (_event: 'change', listener: (state: string) => void) => {
      appState.listeners.add(listener)
      return { remove: () => appState.listeners.delete(listener) }
    },
  },
}))
const { nextAppForeground, subscribeAppResume } = await import('./app-active')

beforeEach(() => {
  appState.currentState = 'active'
  appState.listeners.clear()
})

it('keeps connections in the foreground through iOS inactive prompts', () => {
  let foreground = true
  for (const state of ['inactive', 'active', 'inactive', 'active'] as const) {
    foreground = nextAppForeground(foreground, state)
    expect(foreground).toBe(true)
  }
  foreground = nextAppForeground(foreground, 'background')
  expect(foreground).toBe(false)
  // iOS passes through inactive on the way back. Only active resumes connections.
  expect(nextAppForeground(foreground, 'inactive')).toBe(false)
  expect(nextAppForeground(foreground, 'active')).toBe(true)
  // A cold launch in the inactive state does not start connections.
  expect(nextAppForeground(false, 'inactive')).toBe(false)
  expect(nextAppForeground(false, 'unknown')).toBe(false)
})

it('reports a resume only after the app was in the background', () => {
  const resume = vi.fn<() => void>()
  const unsubscribe = subscribeAppResume(resume)
  // Face ID, Control Center and the app switcher.
  appState.emit('inactive')
  appState.emit('active')
  appState.emit('inactive')
  appState.emit('active')
  expect(resume).not.toHaveBeenCalled()
  appState.emit('inactive')
  appState.emit('background')
  appState.emit('inactive')
  expect(resume).not.toHaveBeenCalled()
  appState.emit('active')
  expect(resume).toHaveBeenCalledTimes(1)
  unsubscribe()
  appState.emit('background')
  appState.emit('active')
  expect(resume).toHaveBeenCalledTimes(1)
})

it('reports the first activation after a cold launch', () => {
  appState.currentState = 'unknown'
  const resume = vi.fn<() => void>()
  subscribeAppResume(resume)
  appState.emit('inactive')
  expect(resume).not.toHaveBeenCalled()
  appState.emit('active')
  expect(resume).toHaveBeenCalledTimes(1)
})
