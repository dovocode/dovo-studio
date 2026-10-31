import { expect, it } from 'vite-plus/test'
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
it('inserts a split beside the selected pane and enforces the four-pane limit', () => {
  let groups = terminalGroups([], ['one'])
  groups = splitTerminal(groups, 'one', 'two', 'columns')
  groups = splitTerminal(groups, 'one', 'three', 'columns')
  expect(groups[0].sessions).toEqual(['one', 'three', 'two'])
  groups = splitTerminal(groups, 'three', 'four', 'rows')
  expect(groups[0].sessions).toEqual(['one', 'three', 'four', 'two'])
  expect(splitTerminal(groups, 'four', 'five', 'rows')).toEqual(groups)
  expect(splitTerminal(groups, 'one', 'two', 'rows')).toEqual(groups)
})
