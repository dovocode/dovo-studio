import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../shared/schema'
import {
  defaultThreadSectionOrder,
  moveThreadSection,
  orderThreadSections,
  threadSectionOrderSchema,
} from './thread-sections'

it('accepts only complete section orders, with no duplicates or unknown categories', () => {
  expect(decodeResult(threadSectionOrderSchema, defaultThreadSectionOrder).success).toBe(true)
  expect(
    decodeResult(threadSectionOrderSchema, [...defaultThreadSectionOrder].reverse()).success,
  ).toBe(true)
  for (const value of [
    [],
    ['active', 'working', 'waiting'],
    [...defaultThreadSectionOrder, 'active'],
    ['active', 'active', 'working', 'waiting', 'snoozed', 'settled'],
    ['unknown', ...defaultThreadSectionOrder.slice(1)],
  ])
    expect(decodeResult(threadSectionOrderSchema, value).success).toBe(false)
})
it('orders categories without changing task or project ordering', () => {
  const order = moveThreadSection(
    moveThreadSection(defaultThreadSectionOrder, 'waiting', -1),
    'waiting',
    -1,
  )
  const groups = [
    { id: 'project:A', tasks: ['one', 'two'] },
    { id: 'project:B', tasks: ['three'] },
    { id: 'working', tasks: ['four'] },
    { id: 'waiting', tasks: ['five'] },
  ]
  expect(orderThreadSections(groups, (group) => group.id, order)).toEqual([
    groups[3],
    groups[0],
    groups[1],
    groups[2],
  ])
  expect(groups.map((group) => group.id)).toEqual(['project:A', 'project:B', 'working', 'waiting'])
  expect(
    orderThreadSections([{ id: 'active' }, { id: 'waiting' }], (group) => group.id, order).map(
      (group) => group.id,
    ),
  ).toEqual(['waiting', 'active'])
  expect(moveThreadSection(defaultThreadSectionOrder, 'pinned', -1)).toEqual(
    defaultThreadSectionOrder,
  )
  expect(moveThreadSection(defaultThreadSectionOrder, 'settled', 1)).toEqual(
    defaultThreadSectionOrder,
  )
})
