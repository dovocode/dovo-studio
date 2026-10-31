import { afterEach, expect, it, vi } from 'vite-plus/test'
import { nextTerminalPane, readTerminalLayout, saveTerminalLayout } from './terminal-layout-state'
afterEach(() => vi.unstubAllGlobals())
it('retains layouts per computer and task and handles unavailable or malformed storage', () => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  })
  const groups = [{ id: 'first', sessions: ['one', 'two'], layout: 'rows' as const }]
  saveTerminalLayout('computer-a:task', 'two', groups)
  expect(readTerminalLayout('computer-a:task')).toEqual({ selected: 'two', groups })
  expect(readTerminalLayout('computer-b:task')).toEqual({ selected: '', groups: [] })
  data.set('dovo.terminal-layout:bad', '{"selected":1,"groups":[]}')
  expect(readTerminalLayout('bad')).toEqual({ selected: '', groups: [] })
  vi.stubGlobal('localStorage', {
    getItem() {
      throw Error('Blocked')
    },
    setItem() {
      throw Error('Blocked')
    },
  })
  expect(() => saveTerminalLayout('a', 'one', groups)).not.toThrow()
  expect(readTerminalLayout('a')).toEqual({ selected: '', groups: [] })
})
it('cycles panes in visual group order', () => {
  expect(nextTerminalPane(['one', 'three', 'two'], 'three', 1)).toBe('two')
  expect(nextTerminalPane(['one', 'three', 'two'], 'one', -1)).toBe('two')
  expect(nextTerminalPane([], 'one', 1)).toBeUndefined()
})
