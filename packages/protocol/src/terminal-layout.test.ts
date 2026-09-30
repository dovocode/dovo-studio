import { expect, it } from 'vitest'
import { splitTerminal, terminalGroups } from './terminal-layout'

it('splits only the selected tab and keeps other tabs independent', () => {
  const groups = terminalGroups([], ['one', 'two'])
  const split = splitTerminal(groups, 'one', 'three', 'rows')
  expect(terminalGroups(split, ['one', 'two', 'three'])).toEqual([
    { id: 'one', sessions: ['one', 'three'], layout: 'rows' },
    { id: 'two', sessions: ['two'], layout: 'columns' },
  ])
  expect(groups[0].sessions).toEqual(['one'])
})
it('retains a tab when its first pane closes and removes empty tabs', () => {
  const groups = splitTerminal(terminalGroups([], ['one', 'two']), 'one', 'three', 'columns')
  expect(terminalGroups(groups, ['two', 'three'])).toEqual([
    { id: 'one', sessions: ['three'], layout: 'columns' },
    { id: 'two', sessions: ['two'], layout: 'columns' },
  ])
  expect(terminalGroups(groups, ['two'])).toEqual([
    { id: 'two', sessions: ['two'], layout: 'columns' },
  ])
})
it('opens restored and externally created sessions as independent tabs without duplication', () => {
  const groups = terminalGroups(
    [{ id: 'a', sessions: ['one', 'two'], layout: 'rows' }],
    ['one', 'two', 'new'],
  )
  expect(groups.map((group) => group.sessions)).toEqual([['one', 'two'], ['new']])
})
