import { expect, test } from 'vite-plus/test'
import { FileDrafts, type FileDraft } from './file-drafts'
const key = (path: string, scope = 'scope-one') => JSON.stringify([scope, path])
const draft = (contents = 'edited'): FileDraft => ({
  contents,
  expectedContents: 'original',
  saving: false,
  error: '',
})

test('defaults to 50 MiB while accounting for original and edited source at admission', () => {
  const drafts = new FileDrafts()
  expect(drafts.budget).toBe(50 * 1024 * 1024)
  expect(drafts.begin(key('large'), 'x'.repeat(12 * 1024 * 1024))).toBe(true)
  expect(drafts.bytes).toBeGreaterThan(48 * 1024 * 1024)
  expect(drafts.begin(key('more'), 'y'.repeat(512 * 1024))).toBe(false)
  drafts.end(key('large'))
  expect(drafts.bytes).toBe(0)
})

test('checks projected allocation before admitting a new draft or editor', () => {
  const drafts = new FileDrafts(200)
  expect(drafts.set(key('a'), draft('x'.repeat(50)))).toBe(true)
  const bytes = drafts.bytes
  expect(bytes).toBeLessThan(200)
  expect(drafts.set(key('b'), draft('y'.repeat(50)))).toBe(false)
  expect(drafts.get(key('b'))).toBeUndefined()
  expect(drafts.bytes).toBe(bytes)
  expect(drafts.begin(key('b'), 'y'.repeat(50))).toBe(false)
})

test('reserves aggregate capacity for clean editors before their first edit', () => {
  const drafts = new FileDrafts(200)
  expect(drafts.begin(key('a'), 'x'.repeat(25))).toBe(true)
  expect(drafts.begin(key('b'), 'y'.repeat(25))).toBe(false)
  drafts.end(key('a'))
  expect(drafts.bytes).toBe(0)
  expect(drafts.begin(key('b'), 'y'.repeat(25))).toBe(true)
})

test('admitted active editor remains usable above budget; new drafts stay blocked', () => {
  const drafts = new FileDrafts(200)
  expect(drafts.begin(key('a'), 'original')).toBe(true)
  expect(drafts.set(key('a'), draft('x'.repeat(300)))).toBe(true)
  expect(drafts.pressure).toBe(true)
  expect(drafts.set(key('a'), draft('x'.repeat(400)))).toBe(true)
  expect(drafts.begin(key('b'), '')).toBe(false)
  expect(drafts.set(key('b'), draft())).toBe(false)
  drafts.end(key('a'))
  expect(drafts.set(key('a'), draft('x'.repeat(500)))).toBe(false)
  // Return to the same editor to shrink or finish the already-admitted draft.
  expect(drafts.begin(key('a'), 'original')).toBe(true)
  expect(drafts.set(key('a'), draft())).toBe(true)
  drafts.end(key('a'))
  expect(drafts.pressure).toBe(false)
  expect(drafts.begin(key('b'), '')).toBe(true)
})

test('scope changes keep every draft discoverable without exposing one in another editor', () => {
  const drafts = new FileDrafts()
  drafts.set(key('a'), draft('first task'))
  drafts.set(key('a', 'scope-two'), draft('other task'))
  expect(drafts.get(key('a'))?.contents).toBe('first task')
  expect(drafts.get(key('a', 'scope-two'))?.contents).toBe('other task')
  expect(drafts.entries().map(({ scope, path }) => [scope, path])).toEqual([
    ['scope-one', 'a'],
    ['scope-two', 'a'],
  ])
  expect(drafts.discard(key('a'))).toBe(true)
  expect(drafts.get(key('a', 'scope-two'))?.contents).toBe('other task')
})

test('saving and failed drafts are never evicted under pressure, and inflight saves cannot be discarded', () => {
  const drafts = new FileDrafts(200)
  drafts.begin(key('a'), 'original')
  const saving = { ...draft('x'.repeat(300)), saving: true }
  drafts.set(key('a'), saving)
  drafts.end(key('a'))
  expect(drafts.discard(key('a'))).toBe(false)
  expect(drafts.get(key('a'))).toBe(saving)
  const failed = { ...saving, saving: false, error: 'conflict' }
  drafts.set(key('a'), failed)
  expect(drafts.get(key('a'))).toBe(failed)
  expect(drafts.unsafe).toBe(true)
  expect(drafts.discard(key('a'))).toBe(true)
  expect(drafts.bytes).toBe(0)
  expect(drafts.unsafe).toBe(false)
})

test('successful saves and deletions release capacity, and shrinking is allowed above budget', () => {
  const drafts = new FileDrafts(200)
  drafts.begin(key('a'), 'original')
  drafts.set(key('a'), draft('x'.repeat(300)))
  drafts.end(key('a'))
  expect(drafts.set(key('a'), draft('small'))).toBe(true)
  expect(drafts.begin(key('b'), '')).toBe(true)
  drafts.end(key('b'))
  drafts.set(key('a'), { ...draft('small'), saving: true })
  expect(drafts.set(key('a'), null)).toBe(true)
  expect(drafts.bytes).toBe(0)
})

test('clean visits retain no metadata and editor reservations release after their last owner', () => {
  const drafts = new FileDrafts()
  for (let index = 0; index < 1_000; index++) {
    const id = key(`file-${index}`, `scope-${index}`)
    expect(drafts.get(id)).toBeUndefined()
    expect(drafts.canBegin(id, 'original')).toBe(true)
    expect(drafts.begin(id, 'original')).toBe(true)
    expect(drafts.begin(id, 'original')).toBe(true)
    drafts.end(id)
    expect(drafts.isEditing(id)).toBe(true)
    drafts.end(id)
    expect(drafts.isEditing(id)).toBe(false)
    expect(drafts.bytes).toBe(0)
  }
  expect(drafts.entries()).toEqual([])
  expect(drafts.unsafe).toBe(false)
})
