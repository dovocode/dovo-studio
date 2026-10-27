import { expect, it } from 'vite-plus/test'
import { appendFile, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from '../../testing/fixture'
import { GitService } from './git'

it('serializes real config writes across linked worktrees, aliases and service instances', async () => {
  const f = await fixture()
  let active = 0
  let peak = 0
  const git = new GitService(undefined, (_cwd, args, result) => {
    if (args[1] !== 'config' || args[2] !== '--local') return
    if (result === undefined) peak = Math.max(peak, ++active)
    else active--
  })
  const other = new GitService()
  try {
    const paths = [f.directory]
    for (let index = 0; index < 7; index++) {
      const path = join(f.directory, `checkout-${index}`)
      await git.addWorktree(f.directory, path, ['--detach', path, 'HEAD'])
      paths.push(path)
    }
    if (process.platform !== 'win32') {
      const alias = join(f.directory, 'alias')
      await symlink(paths[1], alias)
      paths.push(alias)
    }
    // A larger config makes actual Git lock contention easy to reproduce without sleeps.
    await appendFile(
      join(f.directory, '.git/config'),
      `[fixture]\n padding = ${'x'.repeat(512 * 1024)}\n`,
    )
    const writes = Array.from({ length: 32 }, (_, index) =>
      (index % 2 ? other : git).sharedConfigCommand(paths[index % paths.length], [
        'config',
        '--local',
        `dovo.worker${index}`,
        String(index),
      ]),
    )
    const results = await Promise.allSettled(writes)
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    expect(peak).toBe(1)
    expect(active).toBe(0)
    const values = await git.command(paths[1], ['config', '--get-regexp', '^dovo.worker'])
    for (let index = 0; index < writes.length; index++) {
      expect(values.split('\n')).toContain(`dovo.worker${index} ${index}`)
    }
  } finally {
    await f.cleanup()
  }
})

it('allows independent repositories and readers to progress during a config write', async () => {
  const first = await fixture()
  const second = await fixture()
  const git = new GitService()
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const pending = git.withSharedConfig(first.directory, async () => {
    entered()
    await held
    return git.command(first.directory, ['config', 'dovo.first', 'finished'])
  })
  try {
    await started
    await git.sharedConfigCommand(second.directory, ['config', 'dovo.second', 'independent'])
    expect((await git.command(first.directory, ['config', '--get', 'user.name'])).trim()).toBe(
      'Dovo Test',
    )
    expect((await git.command(second.directory, ['config', '--get', 'dovo.second'])).trim()).toBe(
      'independent',
    )
  } finally {
    release()
    await pending
    await Promise.all([first.cleanup(), second.cleanup()])
  }
})

it('creates tracked branches in parallel worktrees without losing upstream configuration', async () => {
  const f = await fixture()
  const git = new GitService()
  try {
    await git.command(f.directory, ['remote', 'add', 'origin', f.directory])
    await git.command(f.directory, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    await appendFile(
      join(f.directory, '.git/config'),
      `[fixture]\n padding = ${'x'.repeat(512 * 1024)}\n`,
    )
    const checkouts = Array.from({ length: 8 }, (_, index) => ({
      branch: `worker-${index}`,
      path: join(f.directory, `worker-${index}`),
    }))
    const results = await Promise.allSettled(
      checkouts.map(({ branch, path }) =>
        git.addWorktree(f.directory, path, ['-b', branch, path, 'refs/remotes/origin/main']),
      ),
    )
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    for (const { branch, path } of checkouts) {
      expect((await git.command(path, ['config', `branch.${branch}.remote`])).trim()).toBe('origin')
      expect((await git.command(path, ['config', `branch.${branch}.merge`])).trim()).toBe(
        'refs/heads/main',
      )
      expect(await readFile(join(path, 'hello.txt'), 'utf8')).toBe('original\n')
    }
  } finally {
    await f.cleanup()
  }
})

it('releases failed writes and leaves an external Git lock untouched', async () => {
  const f = await fixture()
  const git = new GitService()
  const lock = join(f.directory, '.git/config.lock')
  try {
    await writeFile(lock, 'owned by another Git process')
    await expect(
      git.sharedConfigCommand(f.directory, ['config', 'dovo.failed', 'value']),
    ).rejects.toThrow('could not lock config file')
    expect(await readFile(lock, 'utf8')).toBe('owned by another Git process')
    // Only the external owner releases its lock; Studio must never remove or retry it.
    await rm(lock)
    await git.sharedConfigCommand(f.directory, ['config', 'dovo.recovered', 'value'])
    expect((await git.command(f.directory, ['config', '--get', 'dovo.recovered'])).trim()).toBe(
      'value',
    )
  } finally {
    await f.cleanup()
  }
})
