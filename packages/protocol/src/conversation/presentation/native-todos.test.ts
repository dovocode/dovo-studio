import { expect, it } from 'vite-plus/test'
import { nativeTodos, nativeTodoSummary } from './native-todos.js'

it('maps Muse todo statuses and drops cancelled or blank entries', () => {
  expect(
    nativeTodos('session/todoListChanged', {
      items: [
        { text: '  Step one ', status: 'completed' },
        { text: 'Step two', status: 'inProgress' },
        { text: 'Step three', status: 'pending' },
        { text: 'Dropped', status: 'cancelled' },
        { text: '   ', status: 'pending' },
        { text: 'Mystery', status: 'unknown' },
      ],
    }),
  ).toEqual([
    { text: 'Step one', status: 'completed' },
    { text: 'Step two', status: 'in-progress' },
    { text: 'Step three', status: 'pending' },
  ])
})

it('clears on an empty list and ignores other events and malformed payloads', () => {
  expect(nativeTodos('session/todoListChanged', { items: [] })).toEqual([])
  expect(nativeTodos('session/tokenUsage', { items: [] })).toBeUndefined()
  expect(nativeTodos('session/todoListChanged', {})).toBeUndefined()
  expect(nativeTodos('session/todoListChanged', null)).toBeUndefined()
})

it('summarizes progress and the active step', () => {
  expect(
    nativeTodoSummary({
      nativeTodos: [
        { text: 'One', status: 'completed' },
        { text: 'Two', status: 'in-progress' },
        { text: 'Three', status: 'pending' },
      ],
    }),
  ).toEqual({ total: 3, completed: 1, active: 'Two' })
  expect(nativeTodoSummary({ nativeTodos: [] })).toBeUndefined()
  expect(nativeTodoSummary({})).toBeUndefined()
})
