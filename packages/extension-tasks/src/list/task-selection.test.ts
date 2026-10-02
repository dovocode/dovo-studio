import { expect, it } from 'vite-plus/test'
import { selectTaskKeys } from './task-selection'
const order = ['a', 'b', 'c', 'd']
it('toggles a modifier-click without clearing other selected threads', () => {
  expect([...selectTaskKeys(new Set(['a']), 'b', order, 'a', false, true)]).toEqual(['a', 'b'])
  expect([...selectTaskKeys(new Set(['a', 'b']), 'b', order, 'a', false, true)]).toEqual(['a'])
})
it('selects ranges in visible order and supports reverse and additive ranges', () => {
  expect([...selectTaskKeys(new Set(['d']), 'c', order, 'a', true, false)]).toEqual(['a', 'b', 'c'])
  expect([...selectTaskKeys(new Set(['d']), 'a', order, 'c', true, true)]).toEqual([
    'd',
    'a',
    'b',
    'c',
  ])
})
it('falls back to the clicked thread when an anchor is filtered or collapsed', () => {
  expect([...selectTaskKeys(new Set(['a']), 'c', ['b', 'c'], 'a', true, false)]).toEqual(['c'])
})
