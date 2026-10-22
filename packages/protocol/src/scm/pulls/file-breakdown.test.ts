import { expect, it } from 'vite-plus/test'
import { pullFileBreakdown, pullFileKind } from './file-breakdown'

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
  expect(pullFileBreakdown(files)).toBe('1 normal file · 1 mock · 1 test · 1 docs · 1 generated')
  expect(pullFileBreakdown([])).toBe('0 normal files · 0 mocks · 0 tests')
})

it('labels a partial provider response without inventing the missing file categories', () => {
  expect(pullFileBreakdown([{ path: 'src/api.ts' }], 10)).toBe(
    '1 normal file · 0 mocks · 0 tests (1 of 10 files loaded)',
  )
})
