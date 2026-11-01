import { afterEach, expect, it, vi } from 'vite-plus/test'
import { finishSideThread, prepareSideThread } from './side-thread-creation'

afterEach(() => vi.unstubAllGlobals())

it('recovers persisted creation identity across remounts and scopes it to the runtime and parent', () => {
  const values = new Map<string, string>([
    [
      'dovo.sideThreadCreation.mac:parent',
      JSON.stringify({ id: 'saved-child', objective: 'Review' }),
    ],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  expect(prepareSideThread('mac:parent', 'new-child', 'Review')).toBe('saved-child')
  expect(prepareSideThread('other:parent', 'other-child', 'Review')).toBe('other-child')
  finishSideThread('mac:parent', 'saved-child')
  expect(prepareSideThread('mac:parent', 'next-child', 'Review')).toBe('next-child')
})

it('fails before dispatch when available storage cannot persist a creation identity', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('Storage full')
    },
  })
  expect(() => prepareSideThread('storage-failure', 'child', 'Review')).toThrow('Storage full')
})
