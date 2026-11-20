import { expect, it, vi } from 'vite-plus/test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from '../git/git'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration } from '../../testing/integration'
import { ProjectFiles } from './project-files'

const listing = (...records: string[]) => ({ records, truncated: false })

it('refreshes a folder immediately while ordinary reads retain the cached listing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-project-files-'))
  const files = new ProjectFiles(new GitService())
  try {
    await writeFile(join(directory, 'before.txt'), '')
    expect(await files.all(directory, true)).toEqual({ files: ['before.txt'], truncated: false })
    await rm(join(directory, 'before.txt'))
    await writeFile(join(directory, 'after.txt'), '')
    expect(await files.all(directory, true)).toEqual({ files: ['before.txt'], truncated: false })
    expect(await files.all(directory, true, true)).toEqual({
      files: ['after.txt'],
      truncated: false,
    })
    expect(await files.search(directory, 'after', 8, true)).toEqual({ files: ['after.txt'] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('keeps a refreshed Git listing when an older in-flight listing finishes', async () => {
  const git = new GitService()
  let resolve!: (value: ReturnType<typeof listing>) => void
  const older = new Promise<ReturnType<typeof listing>>((done) => {
    resolve = done
  })
  const command = vi.spyOn(git, 'nulRecords').mockReturnValueOnce(older)
  command.mockResolvedValueOnce(listing('new.txt'))
  const files = new ProjectFiles(git)
  const pending = files.all('/checkout')
  expect(await files.all('/checkout', false, true)).toEqual({
    files: ['new.txt'],
    truncated: false,
  })
  resolve(listing('old.txt'))
  expect(await pending).toEqual({ files: ['old.txt'], truncated: false })
  expect(await files.all('/checkout')).toEqual({ files: ['new.txt'], truncated: false })
  expect(command).toHaveBeenCalledTimes(2)
})

it('does not evict a refreshed listing when the older read fails', async () => {
  const git = new GitService()
  let reject!: (reason: Error) => void
  const older = new Promise<ReturnType<typeof listing>>((_resolve, fail) => {
    reject = fail
  })
  const command = vi.spyOn(git, 'nulRecords').mockReturnValueOnce(older)
  command.mockResolvedValueOnce(listing('new.txt'))
  const files = new ProjectFiles(git)
  const failure = new Error('old failure')
  const pending = files.all('/checkout').then(
    () => ({ error: undefined }),
    (error: unknown) => ({ error }),
  )
  expect(await files.all('/checkout', false, true)).toEqual({
    files: ['new.txt'],
    truncated: false,
  })
  reject(failure)
  expect((await pending).error).toBe(failure)
  expect(await files.all('/checkout')).toEqual({ files: ['new.txt'], truncated: false })
  expect(command).toHaveBeenCalledTimes(2)
})

it('allows retrying a failed refresh without reusing its rejected promise', async () => {
  const git = new GitService()
  const command = vi.spyOn(git, 'nulRecords').mockResolvedValueOnce(listing('old.txt'))
  command
    .mockRejectedValueOnce(new Error('refresh failed'))
    .mockResolvedValueOnce(listing('new.txt'))
  const files = new ProjectFiles(git)
  await files.all('/checkout')
  await expect(files.all('/checkout', false, true)).rejects.toThrow('refresh failed')
  expect(await files.all('/checkout')).toEqual({ files: ['new.txt'], truncated: false })
  expect(command).toHaveBeenCalledTimes(3)
})

it('streams Git records, removes duplicates and stops Git after the record limit', async () => {
  const f = await fixture()
  const git = new GitService()
  try {
    await writeFile(join(f.directory, 'hello.txt'), 'modified\n')
    await writeFile(join(f.directory, 'untracked.txt'), '')
    // A modified file appears once for --cached and again for --modified.
    const args = ['ls-files', '--cached', '--modified', '--others', '--exclude-standard', '-z']
    const all = await git.nulRecords(f.directory, args, 2)
    expect(all.truncated).toBe(false)
    expect([...all.records].sort()).toEqual(['hello.txt', 'untracked.txt'])
    const first = await git.nulRecords(f.directory, args, 1)
    expect(first).toEqual({ records: [all.records[0]], truncated: true })
    await expect(git.nulRecords(f.directory, ['ls-files', '--no-such-option'], 1)).rejects.toThrow(
      'ls-files',
    )
  } finally {
    await f.cleanup()
  }
})

it(
  'finds an exact path near the end of an index whose listing exceeds the old output buffer',
  { timeout: runtimeIntegration.testTimeout },
  async () => {
    const f = await fixture()
    try {
      const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: f.directory,
        input: '',
        encoding: 'utf8',
      }).stdout.trim()
      const folder = `packages/${'long-directory-name-'.repeat(5)}`
      const paths = Array.from(
        { length: 120_000 },
        (_, index) => `${folder}/module-${String(index).padStart(6, '0')}/source-file.ts`,
      )
      // Index entries only: Git lists them without 120,000 files in the working tree.
      const added = spawnSync('git', ['update-index', '--add', '--index-info'], {
        cwd: f.directory,
        input: paths.map((path) => `100644 ${blob}\t${path}\n`).join(''),
        maxBuffer: 64 * 1024 * 1024,
      })
      expect({ status: added.status, stderr: String(added.stderr) }).toMatchObject({ status: 0 })
      expect(paths.join('\0').length).toBeGreaterThan(12 * 1024 * 1024)
      const files = new ProjectFiles(new GitService())
      const target = paths[paths.length - 2]!
      expect(await files.search(f.directory, target, 1)).toEqual({ files: [target] })
      expect(await files.pathSearch(f.directory, target)).toEqual(
        expect.objectContaining({ truncated: false }),
      )
      expect((await files.all(f.directory)).files).toHaveLength(paths.length + 1)
    } finally {
      await f.cleanup()
    }
  },
)

it('reports depth omissions only when a skipped directory contains a listable file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-project-files-depth-'))
  const deep = join(directory, ...Array.from({ length: 50 }, () => 'd'))
  const files = new ProjectFiles(new GitService())
  try {
    await mkdir(deep, { recursive: true })
    expect(await files.all(directory, true)).toEqual({ files: [], truncated: false })
    await writeFile(join(deep, 'hidden.txt'), '')
    expect(await files.all(directory, true, true)).toEqual({ files: [], truncated: true })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('leaves completeness unknown when probing skipped directories exceeds its budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-project-files-probe-'))
  const deep = join(directory, ...Array.from({ length: 50 }, () => 'd'))
  const files = new ProjectFiles(new GitService())
  try {
    await mkdir(deep, { recursive: true })
    await Promise.all(Array.from({ length: 1_000 }, (_, index) => mkdir(join(deep, `d${index}`))))
    expect(await files.all(directory, true)).toEqual({ files: [] })
    await writeFile(join(deep, 'hidden.txt'), '')
    expect(await files.all(directory, true, true)).toEqual({ files: [], truncated: true })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
