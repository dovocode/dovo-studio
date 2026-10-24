import { expect, it } from 'vite-plus/test'
import {
  changedFileBreakdown,
  checkpointFileBreakdown,
  pullFileKind,
  changeTypeDistribution,
} from './file-breakdown'

it.each([
  ['src/contest.ts', 'normal'],
  ['src/Latest.java', 'normal'],
  ['src/mocking.ts', 'normal'],
  ['requirements.txt', 'normal'],
  ['CMakeLists.txt', 'normal'],
  ['tests/fixtures/request.json', 'mocks'],
  ['__mocks__/api.ts', 'mocks'],
  ['src/api.mock.ts', 'mocks'],
  ['src/mockClient.ts', 'mocks'],
  ['test/__snapshots__/api.test.ts.snap', 'mocks'],
  ['testdata/input.txt', 'mocks'],
  ['src/api.test.ts', 'tests'],
  ['src/api.browser.spec.tsx', 'tests'],
  ['src/example_test.go', 'tests'],
  ['test_example.py', 'tests'],
  ['conftest.py', 'tests'],
  ['src/WidgetTest.java', 'tests'],
  ['tests/README.md', 'tests'],
  ['src\\__tests__\\api.ts', 'tests'],
  ['e2e/login.cy.ts', 'tests'],
  ['README.md', 'docs'],
  ['docs/guide.mdx', 'docs'],
  ['pnpm-lock.yaml', 'generated'],
  ['ios/Podfile.lock', 'generated'],
  ['src/api.generated.ts', 'generated'],
  ['src/generated/api.ts', 'generated'],
  ['test/__generated__/api.test.ts', 'generated'],
  ['types/api.pb.go', 'generated'],
] as const)('classifies %s as %s', (path, kind) => {
  expect(pullFileKind({ path })).toBe(kind)
})
it('honors generated attributes and counts each current path once, including deletions', () => {
  expect(
    pullFileKind({
      path: 'api.ts',
      attributes: { generated: true, binary: false, vendored: false },
    }),
  ).toBe('generated')
  const files = [
    'src/api.ts',
    'src/api.ts',
    'deleted.test.ts',
    'test/fixtures/api.json',
    'README.md',
    'pnpm-lock.yaml',
  ].map((path) => ({ path }))
  expect(changedFileBreakdown(files)).toBe('Code 1 · Tests 1 · Mocks 1 · Docs 1 · Generated 1')
  expect(changedFileBreakdown([])).toBe('')
})

it('labels a partial provider response without inventing the missing file categories', () => {
  expect(changedFileBreakdown([{ path: 'src/api.ts' }], 10)).toBe('Code 1 (1 of 10 files loaded)')
})

it('shows docs-only changes and hides every category with no changed files', () => {
  expect(changedFileBreakdown([{ path: 'docs/setup.md' }])).toBe('Docs 1')
  expect(changedFileBreakdown([{ path: 'api.test.ts' }])).toBe('Tests 1')
  expect(changedFileBreakdown([], 10)).toBe('(0 of 10 files loaded)')
})

it('includes omitted checkpoint paths and counts shared filenames separately across projects', () => {
  const file = (path: string) => ({ path, before: '', after: 'change', viewed: false })
  const checkpoint = {
    files: ['api.ts', 'tests/api.test.ts', '__mocks__/api.ts'].map(file),
    omitted: ['README.md', 'api.ts', 'client.generated.ts'],
    linked: [
      {
        checkoutId: 'linked',
        repositoryId: 'other',
        directory: '/other',
        before: 'before',
        files: ['tests/api.test.ts', 'README.md'].map(file),
        omitted: [],
      },
    ],
  }
  expect(checkpointFileBreakdown(checkpoint)).toBe(
    'Code 1 · Tests 2 · Mocks 1 · Docs 2 · Generated 1',
  )
  expect(checkpointFileBreakdown({ files: [], omitted: [] })).toBe('')
  expect(checkpointFileBreakdown(undefined)).toBe('')
})

it('weights turn categories by added and removed lines while retaining all file counts', () => {
  const result = changeTypeDistribution(
    [
      { path: 'src/app.ts', additions: 9, deletions: 1 },
      { path: 'src/other.ts', additions: 0, deletions: 10 },
      { path: 'app.test.ts', additions: 80, deletions: 100 },
      { path: 'docs/omitted.md' },
      { path: 'omitted.generated.ts' },
    ],
    'lines',
  )
  expect(result.unit).toBe('lines')
  expect(result.total).toBe(200)
  expect([...result.weights]).toEqual([
    ['normal', 20],
    ['tests', 180],
    ['docs', 0],
    ['generated', 0],
  ])
  expect([...result.counts]).toEqual([
    ['normal', 2],
    ['tests', 1],
    ['docs', 1],
    ['generated', 1],
  ])
})

it('falls back to file counts when lines are unavailable and ignores invalid counts', () => {
  const files = [{ path: 'image.png' }, { path: 'README.md', additions: 0, deletions: 0 }]
  expect(changeTypeDistribution(files, 'lines')).toMatchObject({ unit: 'files', total: 2 })
  expect(changeTypeDistribution([], 'lines')).toMatchObject({ unit: 'files', total: 0 })
  expect(
    changeTypeDistribution([{ path: 'app.ts', additions: Infinity, deletions: -1 }], 'lines').unit,
  ).toBe('files')
  expect(changeTypeDistribution([{ path: 'app.ts', additions: 1, deletions: 9 }]).total).toBe(1)
  expect(
    changeTypeDistribution(
      [{ path: 'app.ts', changeKind: 'docs', additions: 2 }],
      'lines',
    ).weights.get('docs'),
  ).toBe(2)
})
