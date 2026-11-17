import { expect, it } from 'vite-plus/test'
import {
  captureApplicationShortcut,
  matchesApplicationShortcut,
  shortcutBinding,
  shortcutConflict,
} from './shortcuts'

const key = (
  value: string,
  modifiers: Partial<{
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
    altKey: boolean
  }> = {},
) => ({ key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers })
it('keeps defaults, remaps, unassigns and restores without sharing platform modifiers', () => {
  expect(matchesApplicationShortcut(key('k', { ctrlKey: true }), 'palette', {}, false)).toBe(true)
  expect(matchesApplicationShortcut(key('k', { metaKey: true }), 'palette', {}, false)).toBe(false)
  expect(
    matchesApplicationShortcut(
      key('K', { metaKey: true, shiftKey: true }),
      'palette',
      { palette: 'Mod+Shift+k' },
      true,
    ),
  ).toBe(true)
  expect(
    matchesApplicationShortcut(key('k', { ctrlKey: true }), 'palette', { palette: null }, false),
  ).toBe(false)
  expect(shortcutBinding('palette', {})).toBe('Mod+k')
  expect(
    matchesApplicationShortcut(key('k', { ctrlKey: true, altKey: true }), 'palette', {}, false),
  ).toBe(false)
})
it('captures modified keys and rejects ambiguous input and conflicting bindings', () => {
  expect(captureApplicationShortcut(key('J', { metaKey: true, shiftKey: true }), true)).toBe(
    'Mod+Shift+j',
  )
  expect(captureApplicationShortcut(key('j'), false)).toBeUndefined()
  expect(captureApplicationShortcut(key('Dead', { ctrlKey: true }), false)).toBeUndefined()
  expect(shortcutConflict('palette', 'Mod+n', {}, false)).toContain('New thread')
  expect(shortcutConflict('palette', 'Mod+n', { newThread: null }, false)).toBeUndefined()
  expect(shortcutConflict('palette', 'Mod+w', {}, false)).toContain('operating system')
})
