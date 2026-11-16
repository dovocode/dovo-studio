import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec } from '../../process.js'
import { resolveGitLayout } from '../../sandbox/git-mounts.js'
import { GitService } from './git.js'
import {
  gitAddWithoutGitlinks,
  hardenedGitArguments,
  hardenedGitEnvironment,
  type PinnedGitLayout,
} from './hardened-git.js'
import { worktreeChanged } from './worktree-changes.js'

const cleanups: Array<() => Promise<void>> = []
beforeEach(() => {
  // The user's own Git config must not change what these tests see.
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function temp(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}
const git = (cwd: string, ...args: string[]) =>
  exec('git', ['-c', 'user.name=Dovo', '-c', 'user.email=dovo@example.invalid', ...args], {
    cwd,
  }).then((result) => result.stdout)

async function repository() {
  const directory = await temp('dovo-hardened-')
  await git(directory, 'init', '-q')
  await git(directory, 'config', 'user.name', 'Dovo Test')
  await git(directory, 'config', 'user.email', 'test@example.invalid')
  await writeFile(join(directory, 'hello.txt'), 'original\n')
  await git(directory, 'add', 'hello.txt')
  await git(directory, 'commit', '-qm', 'first')
  return directory
}
/** A script that records each run in a marker file, like code an agent would plant. */
async function planted() {
  const directory = await temp('dovo-planted-')
  const marker = join(directory, 'ran')
  const script = join(directory, 'payload.sh')
  await writeFile(script, `#!/bin/sh\necho "$0 $*" >> '${marker}'\ncat\n`)
  await chmod(script, 0o755)
  return { script, ran: () => existsSync(marker), marker }
}
/** Plain `git status` with stdin closed, as a user would run it on the host. */
const plainStatus = (cwd: string) =>
  execFileSync('git', ['status'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
/** A service that treats `layout`'s checkout as sandboxed, as the runtime does after `ensure`. */
function sandboxedService(layout: PinnedGitLayout) {
  const service = new GitService()
  service.setSandboxedCheckouts((path) =>
    path === layout.worktree || path.startsWith(`${layout.worktree}/`) ? layout : undefined,
  )
  return service
}

describe('Dovo Git calls in a sandboxed checkout', () => {
  it('never run a nested repository fsmonitor or clean filter that the agent planted', async () => {
    const directory = await repository()
    const layout = (await resolveGitLayout(directory))!
    const payload = await planted()
    // The agent adds gitlinks to the index and writes the nested repositories' config.
    for (const [name, key] of [
      ['monitor', 'core.fsmonitor'],
      ['filtered', 'filter.x.clean'],
    ] as const) {
      const nested = join(directory, name)
      await mkdir(nested)
      await git(nested, 'init', '-q')
      await writeFile(join(nested, 'x'), 'x\n')
      await git(nested, 'add', 'x')
      await git(nested, 'commit', '-qm', 'x')
      const head = (await git(nested, 'rev-parse', 'HEAD')).trim()
      await git(directory, 'update-index', '--add', '--cacheinfo', `160000,${head},${name}`)
      await git(nested, 'config', key, payload.script)
      await writeFile(join(nested, '.gitattributes'), 'x filter=x\n')
      // Same size, new content: Git must read the file again, which runs the clean filter.
      await writeFile(join(nested, 'x'), 'y\n')
    }
    await writeFile(join(directory, 'hello.txt'), 'edited\n')
    const service = sandboxedService(layout)
    const before = await service.snapshot(directory, 'refs/dovo/checkpoints/turn/before')
    const after = await service.snapshot(directory, 'refs/dovo/checkpoints/turn/after')
    await service.checkpointChanges(directory, before, after)
    await service.changes(directory)
    await service.command(directory, ['status', '--porcelain', '--ignore-submodules=none'])
    await service.command(directory, ['diff', 'HEAD'])
    await service.command(directory, ['diff-files'])
    await service.command(directory, ['diff-index', 'HEAD'])
    await expect(worktreeChanged(service, directory)).resolves.toBe(true)
    await service.stage(directory, ['hello.txt', 'monitor'])
    await service.command(directory, ['add', '-A', '--', '.'])
    await service.commit(directory, 'Commit from the UI')
    expect(payload.ran()).toBe(false)
    // The planted code is real: Git without Dovo's hardening runs it.
    plainStatus(directory)
    expect(payload.ran()).toBe(true)
  })

  it('run no hooks, also for a commit from the UI', async () => {
    const directory = await repository()
    const layout = (await resolveGitLayout(directory))!
    const payload = await planted()
    // Hooks in the real hooks folder: update-ref runs reference-transaction hooks.
    for (const hook of ['pre-commit', 'post-commit', 'reference-transaction']) {
      await writeFile(join(directory, '.git', 'hooks', hook), `#!/bin/sh\n${payload.script}\n`)
      await chmod(join(directory, '.git', 'hooks', hook), 0o755)
    }
    const service = sandboxedService(layout)
    const head = (await service.command(directory, ['rev-parse', 'HEAD'])).trim()
    await writeFile(join(directory, 'hello.txt'), 'edited\n')
    await service.snapshot(directory, 'refs/dovo/checkpoints/turn/before')
    await service.stage(directory, ['hello.txt'])
    const commit = await service.commit(directory, 'Commit from the UI')
    expect((await git(directory, 'rev-parse', `${commit}^`)).trim()).toBe(head)
    expect(payload.ran()).toBe(false)
  })

  it('refuse to run Git after the agent plants a commondir file', async () => {
    const directory = await repository()
    const layout = (await resolveGitLayout(directory))!
    const payload = await planted()
    // The agent writes a fake Git folder into the checkout and points .git/commondir at it.
    const fake = join(directory, 'fake')
    await exec('git', ['init', '-q', '--bare', fake])
    await git(fake, 'config', 'core.bare', 'false')
    await git(fake, 'config', 'core.fsmonitor', payload.script)
    for (const hook of ['pre-commit', 'post-commit', 'reference-transaction']) {
      await writeFile(join(fake, 'hooks', hook), `#!/bin/sh\n${payload.script}\n`)
      await chmod(join(fake, 'hooks', hook), 0o755)
    }
    await writeFile(join(directory, '.git', 'commondir'), '../fake\n')
    await writeFile(join(directory, 'hello.txt'), 'edited\n')
    const service = sandboxedService(layout)
    await expect(service.command(directory, ['status'])).rejects.toThrow(
      /changed since its sandbox/,
    )
    await expect(service.snapshot(directory, 'refs/dovo/checkpoints/turn/before')).rejects.toThrow(
      /changed since its sandbox/,
    )
    await expect(service.commit(directory, 'Commit from the UI')).rejects.toThrow(
      /changed since its sandbox/,
    )
    expect(payload.ran()).toBe(false)
    // Without the recorded layout, Git follows the planted file and runs the code.
    plainStatus(directory)
    expect(payload.ran()).toBe(true)
  })

  it('refuse to run Git after .git is replaced by a link to a planted Git folder', async () => {
    const directory = await repository()
    const layout = (await resolveGitLayout(directory))!
    const payload = await planted()
    const fake = join(directory, 'fake')
    await exec('git', ['init', '-q', '--bare', fake])
    await git(fake, 'config', 'core.bare', 'false')
    await git(fake, 'config', 'core.fsmonitor', payload.script)
    await rename(join(directory, '.git'), join(directory, '.git-moved'))
    await symlink(fake, join(directory, '.git'))
    const service = sandboxedService(layout)
    await expect(service.command(directory, ['status'])).rejects.toThrow(
      /changed since its sandbox/,
    )
    await expect(service.snapshot(directory, 'refs/dovo/checkpoints/turn/before')).rejects.toThrow(
      /changed since its sandbox/,
    )
    expect(payload.ran()).toBe(false)
  })

  it('keep a folder that was not a repository out of Git after the agent runs git init', async () => {
    const directory = await temp('dovo-plain-')
    const payload = await planted()
    const service = sandboxedService({
      worktree: directory,
      gitDir: '/dev/null',
      commonDir: '/dev/null',
    })
    await git(directory, 'init', '-q')
    await git(directory, 'config', 'core.fsmonitor', payload.script)
    await writeFile(join(directory, 'file.txt'), 'x\n')
    expect(await service.isRepository(directory)).toBe(false)
    await expect(service.command(directory, ['status'])).rejects.toThrow(/not a git repository/)
    expect(payload.ran()).toBe(false)
  })

  it('keep hooks and Git behavior for checkouts that no sandbox uses', async () => {
    const directory = await repository()
    const payload = await planted()
    await writeFile(
      join(directory, '.git', 'hooks', 'pre-commit'),
      `#!/bin/sh\n${payload.script}\n`,
    )
    await chmod(join(directory, '.git', 'hooks', 'pre-commit'), 0o755)
    const service = new GitService()
    service.setSandboxedCheckouts(() => undefined)
    await writeFile(join(directory, 'hello.txt'), 'edited\n')
    await service.stage(directory, ['hello.txt'])
    await service.commit(directory, 'Commit with hooks')
    expect(payload.ran()).toBe(true)
  })
})

describe('hardened Git arguments', () => {
  const layout = { worktree: '/w', gitDir: '/w/.git', commonDir: '/w/.git' }

  it('pins the Git folders and appends to existing config overrides', () => {
    const env = hardenedGitEnvironment(layout, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: 'x',
    })
    expect(env).toMatchObject({
      GIT_DIR: '/w/.git',
      GIT_COMMON_DIR: '/w/.git',
      GIT_WORK_TREE: '/w',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_KEY_1: 'core.fsmonitor',
      GIT_CONFIG_VALUE_1: 'false',
      GIT_CONFIG_KEY_2: 'core.hooksPath',
      GIT_CONFIG_VALUE_2: '/dev/null',
    })
    expect(Number(env.GIT_CONFIG_COUNT)).toBeGreaterThan(3)
  })

  it('ignores nested repositories in status and diff, also over an explicit option', () => {
    expect(
      hardenedGitArguments(['status', '--porcelain', '--ignore-submodules=none', '--', 'a']),
    ).toEqual(['status', '--ignore-submodules=all', '--porcelain', '--', 'a'])
    expect(hardenedGitArguments(['-c', 'diff.relative=false', 'diff', '--name-only'])).toEqual([
      '-c',
      'diff.relative=false',
      'diff',
      '--ignore-submodules=all',
      '--name-only',
    ])
    expect(hardenedGitArguments(['diff-tree', 'a', 'b'])).toEqual(['diff-tree', 'a', 'b'])
  })

  it('moves add pathspecs to a private file with gitlink exclusions', async () => {
    const rewritten = await gitAddWithoutGitlinks(
      ['--literal-pathspecs', 'add', '--', 'a[1].txt'],
      ['sub', 'other/nested'],
    )
    try {
      expect(rewritten!.args.slice(0, 2)).toEqual([
        'add',
        expect.stringMatching(/^--pathspec-from-file=/),
      ])
      expect(rewritten!.args).toContain('--pathspec-file-nul')
      const file = rewritten!.args[1]!.slice('--pathspec-from-file='.length)
      expect((await readFile(file, 'utf8')).split('\0')).toEqual([
        ':(literal)a[1].txt',
        ':(exclude,literal)sub',
        ':(exclude,literal)other/nested',
      ])
    } finally {
      await rewritten?.dispose()
    }
    expect(await gitAddWithoutGitlinks(['add', '--', '.'], [])).toBeUndefined()
    expect(await gitAddWithoutGitlinks(['status'], ['sub'])).toBeUndefined()
  })
})
