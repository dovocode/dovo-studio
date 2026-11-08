import { afterEach, expect, it, vi } from 'vite-plus/test'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, rm, writeFile, symlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GitService } from '../git/git.js'
import { ProjectBrowser } from './project-browser.js'
import { fixture } from '../../testing/fixture.js'
import { runtimeIntegration } from '../../testing/integration.js'

vi.mock('node:fs/promises', { spy: true })
vi.setConfig(runtimeIntegration)
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function setup() {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const git = new GitService()
  return { ...f, git, browser: new ProjectBrowser(git) }
}

it('loads only the chosen directory, honors Git ignores, and retains tracked files inside ignored directories', async () => {
  const s = await setup()
  await mkdir(join(s.directory, 'nested'))
  await mkdir(join(s.directory, 'empty'))
  await mkdir(join(s.directory, 'ignored'))
  await writeFile(join(s.directory, 'nested', 'code.ts'), 'needle\n')
  await writeFile(join(s.directory, 'ignored', 'tracked.ts'), 'tracked needle\n')
  await s.git.command(s.directory, ['add', 'ignored/tracked.ts'])
  await writeFile(join(s.directory, '.gitignore'), 'ignored/\nsecret.env\n')
  await writeFile(join(s.directory, 'ignored', 'hidden.ts'), 'hidden needle\n')
  await writeFile(join(s.directory, 'secret.env'), 'needle secret\n')
  const commands = vi.spyOn(s.git, 'readCommand')
  const root = await s.browser.directory(s.directory)
  expect(commands).toHaveBeenCalledTimes(2)
  expect(root.entries.map((entry) => entry.path)).toEqual([
    'empty',
    'ignored',
    'nested',
    '.gitignore',
    'hello.txt',
  ])
  expect(root.entries.some((entry) => entry.path === 'nested/code.ts')).toBe(false)
  expect((await s.browser.directory(s.directory, 'ignored')).entries).toEqual([
    { path: 'ignored/tracked.ts', kind: 'file' },
  ])
  expect((await s.browser.directory(s.directory, 'empty')).entries).toEqual([])
  const hits = await s.browser.search(s.directory, 'needle')
  expect(hits.matches.map((match) => match.path).sort()).toEqual([
    'ignored/tracked.ts',
    'nested/code.ts',
  ])
  expect(hits.truncated).toBe(false)
})

it('pages large directories without duplicating entries and rejects stale cursors', async () => {
  const s = await setup()
  await mkdir(join(s.directory, 'many'))
  await Promise.all(
    Array.from({ length: 205 }, (_, at) => writeFile(join(s.directory, 'many', `${at}.txt`), '')),
  )
  const first = await s.browser.directory(s.directory, 'many')
  expect(first.entries).toHaveLength(200)
  expect(first.nextCursor).toBeTypeOf('string')
  const next = await s.browser.directory(s.directory, 'many', first.nextCursor)
  expect(next.entries).toHaveLength(5)
  expect(next.nextCursor).toBeUndefined()
  expect(new Set([...first.entries, ...next.entries].map((entry) => entry.path)).size).toBe(205)
  await expect(s.browser.directory(s.directory, 'many', 'invalid:200')).rejects.toMatchObject({
    status: 409,
  })
})

it('searches literal UTF-8 lines with exact line numbers, skips binary content and prevents symlink escapes', async () => {
  const s = await setup()
  const outside = await mkdtemp(join(tmpdir(), 'dovo-search-outside-'))
  cleanup.push(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'private.txt'), 'a+b[0]')
  await writeFile(join(s.directory, 'code.ts'), 'first\nconst value = "a+b[0]";\r\nthird\n')
  await writeFile(join(s.directory, 'binary.bin'), Buffer.from([0, ...Buffer.from('a+b[0]')]))
  await symlink(outside, join(s.directory, 'external'))
  await symlink(join(outside, 'private.txt'), join(s.directory, 'link.txt'))
  const result = await s.browser.search(s.directory, 'a+b[0]')
  expect(result.matches).toEqual([
    { path: 'code.ts', line: 2, excerpt: 'const value = "a+b[0]";', matchStart: 15, matchEnd: 21 },
  ])
  await expect(s.browser.directory(s.directory, '../')).rejects.toMatchObject({ status: 400 })
  await expect(s.browser.directory(s.directory, 'external')).rejects.toMatchObject({ status: 400 })
  await expect(s.browser.directory(s.directory, '.git')).rejects.toMatchObject({ status: 400 })
  await expect(s.browser.search(s.directory, 'one\ntwo')).rejects.toMatchObject({ status: 400 })
})

it('bounds result counts and file reads and supports interruption', async () => {
  const s = await setup()
  await writeFile(join(s.directory, 'many.txt'), 'needle\n'.repeat(205))
  const matches = await s.browser.search(s.directory, 'needle')
  expect(matches.matches).toHaveLength(200)
  expect(matches.truncated).toBe(true)
  await rm(join(s.directory, 'many.txt'))
  await writeFile(join(s.directory, 'large.txt'), 'needle'.repeat(200_000))
  const skipped = await s.browser.search(s.directory, 'needle')
  expect(skipped.matches).toHaveLength(0)
  expect(skipped.skippedFiles).toBe(1)
  expect(skipped.truncated).toBe(true)
  const controller = new AbortController()
  controller.abort()
  await expect(s.browser.search(s.directory, 'needle', false, controller.signal)).rejects.toThrow(
    /aborted/i,
  )
  await expect(
    s.browser.directory(s.directory, '', undefined, false, controller.signal),
  ).rejects.toThrow(/aborted/i)
})

it('supports plain folders without Git and does not descend into dependency or Git directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-search-plain-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const git = new GitService()
  const command = vi.spyOn(git, 'readCommand')
  const browser = new ProjectBrowser(git)
  for (const name of ['src', 'node_modules', '.git']) {
    await mkdir(join(directory, name))
    await writeFile(join(directory, name, 'file.ts'), 'needle')
  }
  expect((await browser.directory(directory, '', undefined, true)).entries).toEqual([
    { path: 'src', kind: 'directory' },
  ])
  expect(
    (await browser.search(directory, 'needle', true)).matches.map((match) => match.path),
  ).toEqual(['src/file.ts'])
  expect(command).not.toHaveBeenCalled()
})

it('retains explicit partial results when files or queued directories disappear during traversal', async () => {
  const s = await setup()
  await writeFile(join(s.directory, 'stable.ts'), 'stable needle')
  await writeFile(join(s.directory, 'removed.ts'), 'removed needle')
  for (const name of ['renamed', 'removed', 'replaced']) {
    await mkdir(join(s.directory, name))
    await writeFile(join(s.directory, name, 'code.ts'), 'needle')
  }
  const command = s.git.readCommand.bind(s.git)
  let changed = false
  vi.spyOn(s.git, 'readCommand').mockImplementation(async (cwd, args, limits) => {
    try {
      return await command(cwd, args, limits)
    } finally {
      if (!changed && args[0] === 'check-ignore') {
        changed = true
        await rm(join(s.directory, 'removed.ts'))
        await rm(join(s.directory, 'removed'), { recursive: true })
        await rename(join(s.directory, 'renamed'), join(s.directory, 'moved'))
        await rm(join(s.directory, 'replaced'), { recursive: true })
        await writeFile(join(s.directory, 'replaced'), 'now a file')
      }
    }
  })
  const result = await s.browser.search(s.directory, 'needle')
  expect(result.matches.map((match) => match.path)).toEqual(['stable.ts'])
  expect(result.truncated).toBe(true)
  expect(result.skippedFiles).toBe(4)
})

it('still rejects containment violations when a queued directory becomes an external symlink', async () => {
  const s = await setup()
  const outside = await mkdtemp(join(tmpdir(), 'dovo-search-race-outside-'))
  cleanup.push(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'private.ts'), 'private needle')
  await mkdir(join(s.directory, 'queued'))
  const command = s.git.readCommand.bind(s.git)
  let changed = false
  vi.spyOn(s.git, 'readCommand').mockImplementation(async (cwd, args, limits) => {
    try {
      return await command(cwd, args, limits)
    } finally {
      if (!changed && args[0] === 'check-ignore') {
        changed = true
        await rm(join(s.directory, 'queued'), { recursive: true })
        await symlink(outside, join(s.directory, 'queued'))
      }
    }
  })
  await expect(s.browser.search(s.directory, 'needle')).rejects.toMatchObject({ status: 400 })
})

it('browses contained sibling aliases but excludes dangling, Git, ignored and ancestor links', async () => {
  const s = await setup()
  await mkdir(join(s.directory, 'src'))
  await writeFile(join(s.directory, 'src', 'code.ts'), 'needle')
  await mkdir(join(s.directory, 'hidden'))
  await writeFile(join(s.directory, '.gitignore'), 'hidden/\nignored-link\n')
  for (const [name, target] of [
    ['alias', 'src'],
    ['file.ts', 'src/code.ts'],
    ['git-link', '.git'],
    ['missing', 'absent'],
    ['hidden-link', 'hidden'],
    ['ignored-link', 'src'],
    ['src/loop', '..'],
    ['src/self', '.'],
  ])
    await symlink(target, join(s.directory, name))
  const root = await s.browser.directory(s.directory)
  expect(root.entries).toContainEqual({ path: 'alias', kind: 'directory' })
  expect(root.entries).toContainEqual({ path: 'file.ts', kind: 'file' })
  for (const name of ['git-link', 'missing', 'hidden-link', 'ignored-link'])
    expect(root.entries.some((entry) => entry.path === name)).toBe(false)
  expect((await s.browser.directory(s.directory, 'alias')).entries).toEqual([
    { path: 'alias/code.ts', kind: 'file' },
  ])
  await expect(s.browser.directory(s.directory, 'alias/loop/src')).rejects.toMatchObject({
    status: 400,
  })
  expect(
    (await s.browser.search(s.directory, 'needle')).matches.map((match) => match.path),
  ).toEqual(['src/code.ts'])
})

it('rejects a directory link replaced during ignore checks and invalidates replacement cursors', async () => {
  const s = await setup()
  for (const name of ['first', 'second']) {
    await mkdir(join(s.directory, name))
    await Promise.all(
      Array.from({ length: 201 }, (_, at) => writeFile(join(s.directory, name, `${at}.txt`), '')),
    )
  }
  await symlink('first', join(s.directory, 'alias'))
  const first = await s.browser.directory(s.directory, 'alias')
  await rm(join(s.directory, 'alias'))
  await symlink('second', join(s.directory, 'alias'))
  await expect(s.browser.directory(s.directory, 'alias', first.nextCursor)).rejects.toMatchObject({
    status: 409,
  })
  const command = s.git.readCommand.bind(s.git)
  let changed = false
  vi.spyOn(s.git, 'readCommand').mockImplementation(async (...args) => {
    try {
      return await command(...args)
    } finally {
      if (!changed) {
        changed = true
        await rm(join(s.directory, 'alias'))
        await symlink('first', join(s.directory, 'alias'))
      }
    }
  })
  await expect(s.browser.directory(s.directory, 'alias')).rejects.toMatchObject({ status: 409 })
})

it('pages hundreds of contained symlinks without duplicate entries in plain folders', async () => {
  const s = await setup()
  await mkdir(join(s.directory, 'many-links'))
  await writeFile(join(s.directory, 'target.txt'), 'target')
  for (let at = 0; at < 205; at++)
    await symlink('../target.txt', join(s.directory, 'many-links', `${at}.txt`))
  const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  let active = 0,
    maximum = 0
  vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
    maximum = Math.max(maximum, ++active)
    try {
      return await original.lstat(...args)
    } finally {
      active--
    }
  })
  const first = await s.browser.directory(s.directory, 'many-links', undefined, true)
  const next = await s.browser.directory(s.directory, 'many-links', first.nextCursor, true)
  expect(first.entries).toHaveLength(200)
  expect(next.entries).toHaveLength(5)
  expect(new Set([...first.entries, ...next.entries].map((entry) => entry.path)).size).toBe(205)
  expect(maximum).toBeGreaterThan(1)
  expect(maximum).toBeLessThanOrEqual(32)
})

it('fails closed when a folder alias is redirected outside during ignore checks', async () => {
  const s = await setup()
  const outside = await mkdtemp(join(tmpdir(), 'dovo-browser-race-'))
  cleanup.push(() => rm(outside, { recursive: true, force: true }))
  await mkdir(join(s.directory, 'src'))
  await writeFile(join(s.directory, 'src', 'code.ts'), 'safe')
  await writeFile(join(outside, 'private.txt'), 'private')
  await symlink('src', join(s.directory, 'alias'))
  const command = s.git.readCommand.bind(s.git)
  let changed = false
  vi.spyOn(s.git, 'readCommand').mockImplementation(async (...args) => {
    try {
      return await command(...args)
    } finally {
      if (!changed) {
        changed = true
        await rm(join(s.directory, 'alias'))
        await symlink(outside, join(s.directory, 'alias'))
      }
    }
  })
  await expect(s.browser.directory(s.directory, 'alias')).rejects.toMatchObject({ status: 400 })
})

it('lists ordinary dirents without per-entry stats or canonical walks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-browser-ordinary-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  await Promise.all(
    Array.from({ length: 200 }, (_, at) =>
      at === 199 ? mkdir(join(directory, 'folder')) : writeFile(join(directory, `${at}.txt`), ''),
    ),
  )
  const stats = vi.spyOn(fs, 'lstat')
  const canonical = vi.spyOn(fs, 'realpath')
  const result = await new ProjectBrowser(new GitService()).directory(
    directory,
    '',
    undefined,
    true,
  )
  expect(result.entries).toHaveLength(200)
  expect(stats.mock.calls.length).toBeLessThanOrEqual(2)
  expect(stats.mock.calls.every(([path]) => path === directory)).toBe(true)
  expect(canonical.mock.calls.length).toBeLessThanOrEqual(4)
})

it('rejects an ordinary entry replaced with a link during ignore checks', async () => {
  const s = await setup()
  await writeFile(join(s.directory, 'ordinary.txt'), 'original')
  const before = await fs.stat(s.directory)
  const command = s.git.readCommand.bind(s.git)
  let changed = false
  vi.spyOn(s.git, 'readCommand').mockImplementation(async (...args) => {
    try {
      return await command(...args)
    } finally {
      if (!changed) {
        changed = true
        await rm(join(s.directory, 'ordinary.txt'))
        await symlink('hello.txt', join(s.directory, 'ordinary.txt'))
        await fs.utimes(s.directory, before.atime, before.mtime)
      }
    }
  })
  await expect(s.browser.directory(s.directory)).rejects.toMatchObject({ status: 409 })
})

it('rejects replacement of a linked file target outside the listed directory', async () => {
  const s = await setup()
  await mkdir(join(s.directory, 'actual'))
  const target = join(s.directory, 'actual', 'target.txt')
  await writeFile(target, 'original')
  await symlink('actual/target.txt', join(s.directory, 'alias.txt'))
  const command = s.git.readCommand.bind(s.git)
  let changed = false
  vi.spyOn(s.git, 'readCommand').mockImplementation(async (...args) => {
    try {
      return await command(...args)
    } finally {
      if (!changed) {
        changed = true
        await rename(target, join(s.directory, 'actual', 'old.txt'))
        await writeFile(target, 'replacement')
      }
    }
  })
  await expect(s.browser.directory(s.directory)).rejects.toMatchObject({ status: 409 })
})
