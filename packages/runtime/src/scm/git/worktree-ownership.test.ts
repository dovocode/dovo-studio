import { afterEach, expect, it, vi } from 'vite-plus/test'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fixture } from '../../testing/fixture'
import { GitService } from './git'
import * as owned from '../../agents/execution/stop-owned-child'
import { availableWorktree, worktreeRecords } from './worktree-records'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('drains an owned Git command on its deadline and releases the checkout for subsequent work', async () => {
  if (process.platform === 'win32') return
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  await expect(
    git.checkoutCommand(
      f.directory,
      ['-c', 'alias.wait=!sleep 30', 'wait'],
      undefined,
      undefined,
      200,
    ),
  ).rejects.toThrow('Git checkout timed out')
  await expect(git.inspect(f.directory)).resolves.toMatchObject({ path: f.directory })
})

it('reports an escaped setup descendant retaining pipes without releasing the preparation lock', async () => {
  if (process.platform === 'win32') return
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const target = join(f.directory, 'escaped-setup')
  const marker = join(f.directory, 'escaped.pid')
  await git.addWorktree(f.directory, target, ['--detach', target, 'HEAD'])
  const source = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(c.pid));c.unref()`
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  let pid = 0
  try {
    await expect(
      git.withWorktreePreparation(target, () =>
        git.setupWorktree(target, `exec ${quote(process.execPath)} -e ${quote(source)}`),
      ),
    ).rejects.toBeInstanceOf(owned.OwnedProcessShutdownError)
    pid = Number(await readFile(marker, 'utf8'))
    expect(pid).toBeGreaterThan(0)
    await expect(new GitService().inspect(target)).rejects.toMatchObject({ status: 409 })
    expect(await git.command(f.directory, ['worktree', 'list', '--porcelain', '-z'])).toContain(
      'locked dovo-preparing ',
    )
  } finally {
    if (!pid) pid = Number(await readFile(marker, 'utf8').catch(() => '0'))
    if (pid) process.kill(-pid, 'SIGKILL')
  }
  await vi.waitFor(() =>
    expect(new GitService().inspect(target)).resolves.toMatchObject({ path: target }),
  )
}, 10000)

it('refuses a checkout after its setup owner is killed while the detached command remains alive', async () => {
  if (process.platform === 'win32') return
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const target = join(f.directory, 'crashed-setup')
  const marker = join(f.directory, 'setup.pid')
  await git.addWorktree(f.directory, target, ['--detach', target, 'HEAD'])
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  const command =
    `exec ${quote(process.execPath)} -e ` +
    quote(
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`,
    )
  // Like the server lifecycle tests, exercise the built launcher in an independent process.
  const moduleUrl = new URL('../../../dist/scm/git/git.js', import.meta.url).href
  const source = `import {GitService} from ${JSON.stringify(moduleUrl)};const git=new GitService();await git.withWorktreePreparation(${JSON.stringify(target)},()=>git.setupWorktree(${JSON.stringify(target)},${JSON.stringify(command)}))`
  const owner = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    stdio: 'ignore',
  })
  let pid = 0
  cleanups.push(async () => {
    if (pid)
      try {
        process.kill(-pid, 'SIGKILL')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
      }
    if (owner.exitCode === null && owner.signalCode === null) {
      const exited = once(owner, 'exit')
      owner.kill('SIGKILL')
      await exited
    }
  })
  await vi.waitFor(
    async () => {
      pid = Number(await readFile(marker, 'utf8'))
      expect(pid).toBeGreaterThan(0)
    },
    { timeout: 10000 },
  )
  const exited = once(owner, 'exit')
  owner.kill('SIGKILL')
  await exited
  expect(() => process.kill(pid, 0)).not.toThrow()
  await expect(new GitService().inspect(target)).rejects.toMatchObject({ status: 409 })
  expect(await git.command(f.directory, ['worktree', 'list', '--porcelain', '-z'])).toContain(
    'locked dovo-preparing ',
  )
}, 15000)

it('retains durable preparation ownership until an unconfirmed command exits and preserves replacement locks', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const target = join(f.directory, 'preparation')
  await git.addWorktree(f.directory, target, ['--detach', target, 'HEAD'])
  const records = async () =>
    worktreeRecords(await git.command(f.directory, ['worktree', 'list', '--porcelain', '-z']))
  const confirmed = barrier()
  const failure = new owned.OwnedProcessShutdownError('setup still owns files', {
    confirmed: confirmed.promise,
  })
  try {
    await expect(
      git.withWorktreePreparation(target, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    const held = (await records()).find((record) => record.path === target)
    expect(held?.creating).toBe(true)
    if (!held) throw new Error('Expected the owned worktree registration')
    expect(availableWorktree(held, f.directory)).toBe(false)
    await expect(new GitService().inspect(target)).rejects.toMatchObject({ status: 409 })
    let admitted = false
    await expect(
      new GitService().withWorktreePreparation(target, async () => {
        admitted = true
      }),
    ).rejects.toMatchObject({ status: 409 })
    expect(admitted).toBe(false)
  } finally {
    confirmed.resolve()
  }
  await vi.waitFor(async () =>
    expect((await records()).find((record) => record.path === target)?.creating).toBe(false),
  )
  await expect(
    git.withWorktreePreparation(target, () => new GitService().inspect(target)),
  ).resolves.toMatchObject({ path: target })
  await expect(
    git.withWorktreePreparation(target, async () => {
      throw new Error('ordinary setup failure')
    }),
  ).rejects.toThrow('ordinary setup failure')
  expect((await records()).find((record) => record.path === target)?.creating).toBe(false)
  await expect(
    git.withWorktreePreparation(target, async () => {
      await git.command(f.directory, ['worktree', 'unlock', target])
      await git.command(f.directory, ['worktree', 'lock', '--reason', 'external owner', target])
    }),
  ).rejects.toMatchObject({ status: 409 })
  expect(await git.command(f.directory, ['worktree', 'list', '--porcelain', '-z'])).toContain(
    'locked external owner',
  )
})

it('drains a checkout hook and its child on cancellation, then safely reattaches its retained branch', async () => {
  if (process.platform === 'win32') return
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const target = join(f.directory, 'checkout')
  const marker = join(f.directory, 'hook-child.pid')
  await writeFile(
    join(f.directory, '.git/hooks/post-checkout'),
    `#!/bin/sh
trap 'kill "$child" 2>/dev/null; wait "$child" 2>/dev/null; exit 143' TERM
sleep 30 &
child=$!
echo "$child" > '${marker.replaceAll("'", "'\\''")}'
wait "$child"
`,
    { mode: 0o755 },
  )
  const controller = new AbortController()
  const pending = git.addWorktree(
    f.directory,
    target,
    ['-b', 'cancelled', target, 'HEAD'],
    controller.signal,
  )
  // Attach a rejection handler before triggering cancellation.
  const result = pending.catch((error: unknown) => error)
  let pid = 0
  try {
    await vi.waitFor(async () => {
      pid = Number(await readFile(marker, 'utf8'))
      expect(pid).toBeGreaterThan(0)
    })
    controller.abort(new Error('test cancellation'))
    expect(await result).toBeInstanceOf(Error)
    expect(() => process.kill(pid, 0)).toThrow('ESRCH')
  } finally {
    controller.abort(new Error('test cleanup'))
    await result
  }
  await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await git.command(f.directory, ['worktree', 'list', '--porcelain', '-z'])).not.toContain(
    `worktree ${target}\0`,
  )
  await writeFile(join(f.directory, '.git/hooks/post-checkout'), '#!/bin/sh\nexit 0\n')
  await git.addWorktree(f.directory, target, [target, 'cancelled'])
  expect(await readFile(join(target, 'hello.txt'), 'utf8')).toBe('original\n')
}, 15000)

it('preserves a replacement folder when preparation fails after another actor moved the owned checkout', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const target = join(f.directory, 'checkout')
  const moved = join(f.directory, 'original-checkout')
  const command = git.checkoutCommand.bind(git)
  vi.spyOn(git, 'checkoutCommand').mockImplementation(async (cwd, args, signal, env) => {
    const output = await command(cwd, args, signal, env)
    if (args[0] === 'worktree' && args[1] === 'add') {
      await rename(target, moved)
      await mkdir(target)
      await writeFile(join(target, 'keep.txt'), 'external replacement')
    }
    return output
  })
  await expect(
    git.addWorktree(f.directory, target, ['-b', 'replacement', target, 'HEAD']),
  ).rejects.toMatchObject({ status: 409 })
  expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('external replacement')
  expect(await readFile(join(moved, 'hello.txt'), 'utf8')).toBe('original\n')
  expect(await git.command(f.directory, ['worktree', 'list', '--porcelain', '-z'])).toContain(
    'locked dovo-creating ',
  )
})

it('preserves preexisting folders and refuses Git versions without creation ownership', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const target = join(f.directory, 'external')
  await mkdir(target)
  await writeFile(join(target, 'keep.txt'), 'external data')
  await expect(
    git.addWorktree(f.directory, target, ['--detach', target, 'HEAD']),
  ).rejects.toMatchObject({ status: 409 })
  expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('external data')
  const command = git.command.bind(git)
  vi.spyOn(git, 'command').mockImplementation((cwd, args, env) =>
    args[0] === '--version' ? Promise.resolve('git version 2.35.0') : command(cwd, args, env),
  )
  const unsupported = join(f.directory, 'unsupported')
  await expect(
    git.addWorktree(f.directory, unsupported, ['--detach', unsupported, 'HEAD']),
  ).rejects.toThrow('Git 2.36')
  await expect(lstat(unsupported)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('blocks another service from using a checkout after an unconfirmed preparation stop until exit confirmation', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const confirmed = barrier()
  const failure = new owned.OwnedProcessShutdownError('preparation stop unconfirmed', {
    confirmed: confirmed.promise,
  })
  const stop = vi.spyOn(owned, 'stopOwnedChild').mockRejectedValueOnce(failure)
  try {
    await expect(git.checkoutCommand(f.directory, ['status', '--porcelain'])).rejects.toBe(failure)
    stop.mockRestore()
    await expect(new GitService().inspect(f.directory)).rejects.toMatchObject({ status: 409 })
    const refused = join(f.directory, 'refused')
    await expect(
      new GitService().addWorktree(f.directory, refused, ['--detach', refused, 'HEAD']),
    ).rejects.toMatchObject({ status: 409 })
    await expect(lstat(refused)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    confirmed.resolve()
  }
  await expect(new GitService().inspect(f.directory)).resolves.toMatchObject({ path: f.directory })
})

it('keeps a cancelled queued config writer behind its predecessor and retains unconfirmed ownership', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  const entered = barrier()
  const release = barrier()
  const first = git.withSharedConfig(f.directory, async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  const controller = new AbortController()
  const cancelled = git.withSharedConfig(
    f.directory,
    async () => {
      throw new Error('cancelled writer entered')
    },
    controller.signal,
  )
  const rejected = cancelled.catch((error: unknown) => error)
  controller.abort(new Error('cancel queued writer'))
  expect(await rejected).toMatchObject({ message: 'cancel queued writer' })
  let successorEntered = false
  const successor = git.withSharedConfig(f.directory, async () => {
    successorEntered = true
  })
  await git.command(f.directory, ['status', '--porcelain'])
  expect(successorEntered).toBe(false)
  release.resolve()
  await Promise.all([first, successor])
  const confirmed = barrier()
  const failure = new owned.OwnedProcessShutdownError('config writer not stopped', {
    confirmed: confirmed.promise,
  })
  await expect(
    git.withSharedConfig(f.directory, async () => {
      throw failure
    }),
  ).rejects.toBe(failure)
  successorEntered = false
  const held = git.withSharedConfig(f.directory, async () => {
    successorEntered = true
  })
  await git.command(f.directory, ['status', '--porcelain'])
  expect(successorEntered).toBe(false)
  confirmed.resolve()
  await held
  expect(successorEntered).toBe(true)
})
