import { afterEach, expect, it, vi } from 'vite-plus/test'
import { writeFile, rename, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { GitService } from './git.js'
import { LocalCommits } from './local-commits.js'
import { fixture } from '../../testing/fixture.js'
import { runtimeIntegration } from '../../testing/integration.js'

vi.setConfig(runtimeIntegration)
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function setup() {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const git = new GitService()
  return { ...f, git, commits: new LocalCommits(git) }
}

it('reviews root and normal commits without changing files, the index or refs', async () => {
  const s = await setup()
  const first = (await s.commits.list(s.directory)).commits[0]
  expect(first.subject).toBe('Initial fixture')
  expect(first.parents).toEqual([])
  expect((await s.commits.changes(s.directory, first.sha)).files).toEqual([
    { path: 'hello.txt', before: '', after: 'original\n', viewed: false },
  ])
  await writeFile(join(s.directory, 'hello.txt'), 'committed\n')
  await s.git.stage(s.directory, ['hello.txt'])
  const sha = await s.git.commit(s.directory, 'Subject with a tab\tand unicode →')
  await writeFile(join(s.directory, 'hello.txt'), 'working\n')
  const index = await s.git.command(s.directory, ['ls-files', '--stage'])
  const refs = await s.git.command(s.directory, ['show-ref'])
  const changes = await s.commits.changes(s.directory, sha)
  expect(changes.files[0]).toMatchObject({ before: 'original\n', after: 'committed\n' })
  expect((await s.commits.list(s.directory)).commits[0].subject).toContain('\tand unicode →')
  expect(await s.git.command(s.directory, ['ls-files', '--stage'])).toBe(index)
  expect(await s.git.command(s.directory, ['show-ref'])).toBe(refs)
  expect((await s.git.changes(s.directory))[0].after).toBe('working\n')
})

it('pins deferred and binary previews to a commit and represents renames as delete/add', async () => {
  const s = await setup()
  await rename(join(s.directory, 'hello.txt'), join(s.directory, 'renamed.txt'))
  const contents = 'a'.repeat(300_000)
  await writeFile(join(s.directory, 'large.txt'), contents)
  await writeFile(join(s.directory, 'binary.bin'), Buffer.from([0, 1, 2]))
  await s.git.stage(s.directory, ['hello.txt', 'renamed.txt', 'large.txt', 'binary.bin'])
  const sha = await s.git.commit(s.directory, 'Rename and add previews')
  await writeFile(join(s.directory, 'large.txt'), 'different working contents')
  const { files } = await s.commits.changes(s.directory, sha)
  expect(files.find((file) => file.path === 'hello.txt')).toMatchObject({
    before: 'original\n',
    after: '',
  })
  expect(files.find((file) => file.path === 'renamed.txt')).toMatchObject({
    before: '',
    after: 'original\n',
  })
  expect(files.find((file) => file.path === 'binary.bin')?.preview?.kind).toBe('binary')
  const compact = await s.commits.preview(s.directory, sha, 'large.txt')
  expect(compact.after?.truncated).toBe(true)
  const full = await s.commits.preview(s.directory, sha, 'large.txt', true)
  expect(full.after?.text).toBe(contents)
  expect(full.after?.truncated).not.toBe(true)
})

it('uses the first parent for merge commits and rejects commits outside the selected history', async () => {
  const s = await setup()
  const initial = (await s.commits.list(s.directory)).commits[0].sha
  await s.git.command(s.directory, ['checkout', '-b', 'feature'])
  await writeFile(join(s.directory, 'feature.txt'), 'feature\n')
  await s.git.stage(s.directory, ['feature.txt'])
  const feature = await s.git.commit(s.directory, 'Feature')
  await s.git.command(s.directory, ['checkout', '-b', 'primary', initial])
  await expect(s.commits.changes(s.directory, feature)).rejects.toMatchObject({ status: 404 })
  await s.git.command(s.directory, ['merge', '--no-ff', '-m', 'Merge feature', feature])
  const merge = (await s.commits.list(s.directory)).commits[0]
  expect(merge.parents).toHaveLength(2)
  expect((await s.commits.changes(s.directory, merge.sha)).files.map((file) => file.path)).toEqual([
    'feature.txt',
  ])
  await expect(s.commits.resolve(s.directory, 'f'.repeat(40))).rejects.toMatchObject({
    status: 404,
  })
  await expect(s.commits.resolve(s.directory, '--all')).rejects.toBeInstanceOf(Error)
  await expect(s.commits.preview(s.directory, merge.sha, '../outside')).rejects.toMatchObject({
    status: 400,
  })
})

it('pages a pinned first-parent history and handles an unborn repository', async () => {
  const s = await setup()
  for (let at = 0; at < 41; at++)
    await s.git.command(s.directory, ['commit', '--allow-empty', '-qm', `Commit ${at}`])
  const page = await s.commits.list(s.directory)
  expect(page.commits).toHaveLength(40)
  expect(page.hasMore).toBe(true)
  const next = await s.commits.list(s.directory, page.commits.at(-1)?.parents[0])
  expect(next.commits).toHaveLength(2)
  expect(next.hasMore).toBe(false)
  expect(new Set([...page.commits, ...next.commits].map((commit) => commit.sha)).size).toBe(42)
  await s.git.command(s.directory, ['checkout', '--orphan', 'unborn'])
  // Other branches exist, but this selected checkout has no history yet.
  expect(await s.commits.list(s.directory)).toEqual({ commits: [], hasMore: false })
})

it('reports missing shallow history instead of showing the entire tree as a new root', async () => {
  const s = await setup()
  await writeFile(join(s.directory, 'hello.txt'), 'next\n')
  await s.git.stage(s.directory, ['hello.txt'])
  const sha = await s.git.commit(s.directory, 'Next')
  const clone = await mkdtemp(join(tmpdir(), 'dovo-shallow-review-'))
  cleanup.push(() => rm(clone, { recursive: true, force: true }))
  await s.git.command(s.directory, ['clone', '--depth=1', pathToFileURL(s.directory).href, clone])
  await expect(s.commits.changes(clone, sha)).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining('Fetch more history'),
  })
  await expect(s.commits.preview(clone, sha, 'hello.txt')).rejects.toMatchObject({ status: 409 })
})
