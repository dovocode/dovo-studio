import { expect, it } from 'vite-plus/test'
import { refreshFirstPage } from './collection-pages'

it('refreshes arbitrary provider page sizes without dropping later loaded rows', () => {
  const previous = [
    { id: '1', value: 'old' },
    { id: '2', value: 'stale' },
    { id: '3', value: 'later' },
  ]
  expect(
    refreshFirstPage(previous, ['1', '2'], [{ id: '1', value: 'new' }], (row) => row.id),
  ).toEqual([
    { id: '1', value: 'new' },
    { id: '3', value: 'later' },
  ])
})

it('uses the fresh value when a later item moves into page one', () => {
  expect(
    refreshFirstPage(
      [{ id: 'later', value: 'old' }],
      [],
      [{ id: 'later', value: 'new' }],
      (row) => row.id,
    ),
  ).toEqual([{ id: 'later', value: 'new' }])
})
