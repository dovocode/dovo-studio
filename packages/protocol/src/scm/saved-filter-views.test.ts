import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import {
  availableSavedFilterView,
  savedFilterScope,
  savedFilterSourceScope,
  savedFilterViewsSchema,
  saveFilterView,
  savedPullLabels,
  type SavedFilterView,
} from './saved-filter-views.js'

const scope = savedFilterScope(['computer/account-a'])
const sources = [{ key: 'repo-a', identity: 'account-a/repo-a' }]
const view: SavedFilterView = {
  id: 'view',
  name: ' My open work ',
  kind: 'issues',
  scope,
  sourceScope: savedFilterSourceScope('repo-a', sources),
  filters: { source: 'repo-a', state: 'open', search: 'bug', sort: 'updated' },
}

it('creates, renames and updates views without changing other views', () => {
  const first = saveFilterView([], view)
  expect(first[0].name).toBe('My open work')
  const other = { ...view, id: 'other', name: 'Other' }
  const renamed = saveFilterView([...first, other], {
    ...first[0],
    name: 'Assigned',
    filters: { ...view.filters, search: 'assigned' },
  })
  expect(renamed).toEqual([
    other,
    { ...view, name: 'Assigned', filters: { ...view.filters, search: 'assigned' } },
  ])
  expect(first[0].name).toBe('My open work')
  expect(decode(savedFilterViewsSchema, renamed)).toEqual(renamed)
  expect(() => saveFilterView(first, { ...view, id: 'duplicate', name: 'my open work' })).toThrow(
    'already exists',
  )
  expect(() => saveFilterView(first, { ...view, name: '  ' })).toThrow('1 to 80')
})

it('keeps views when projects are added and isolates replaced accounts and sources', () => {
  expect(
    availableSavedFilterView(view, scope, [...sources, { key: 'repo-b', identity: 'b' }]),
  ).toBe(true)
  expect(
    availableSavedFilterView(
      view,
      savedFilterScope(['computer/account-a', 'another-computer']),
      sources,
    ),
  ).toBe(true)
  expect(
    availableSavedFilterView(
      { ...view, filters: { ...view.filters, source: '' } },
      'different-connections',
      sources,
    ),
  ).toBe(false)
  expect(
    availableSavedFilterView(view, scope, [{ key: 'repo-a', identity: 'other-account/repo-a' }]),
  ).toBe(false)
  expect(availableSavedFilterView(view, scope, [])).toBe(false)
  expect(
    availableSavedFilterView({ ...view, filters: { ...view.filters, source: '' } }, scope, []),
  ).toBe(true)
  expect(savedFilterScope(['a', 'b'])).toBe(savedFilterScope(['b', 'a']))
  expect(scope).not.toContain('account')
})

it('round-trips multiple labels and reads the older single-label format', () => {
  const pullView = {
    ...view,
    kind: 'pulls' as const,
    filters: { ...view.filters, pullLabels: ['bug', 'docs'] },
  }
  const saved = saveFilterView([], pullView)
  expect(savedPullLabels(decode(savedFilterViewsSchema, saved)[0].filters)).toEqual(['bug', 'docs'])
  expect(savedPullLabels({ pullLabel: 'bug' })).toEqual(['bug'])
  expect(savedPullLabels({ pullLabels: [], pullLabel: 'bug' })).toEqual([])
})

it('bounds device storage and accepts the same name in another source scope', () => {
  const full = Array.from({ length: 100 }, (_, i) => ({
    ...view,
    id: String(i),
    name: `View ${i}`,
  }))
  expect(() => saveFilterView(full, view)).toThrow('limit is 100')
  expect(saveFilterView([view], { ...view, id: 'different', scope: 'other' })).toHaveLength(2)
  expect(() => decode(savedFilterViewsSchema, [...full, view])).toThrow('100')
})
