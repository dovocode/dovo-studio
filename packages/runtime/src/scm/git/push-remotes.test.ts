import { expect, it } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixture } from '../../testing/fixture.js'
import { GitService } from './git.js'

it('honors branch pushRemote and remote.pushDefault without replacing the fetch upstream', async () => {
  const f = await fixture()
  const root = await mkdtemp(join(tmpdir(), 'dovo-push-remotes-'))
  const git = new GitService()
  try {
    for (const name of ['fetch', 'default', 'branch']) {
      await git.command(root, ['init', '--bare', '-q', join(root, name)])
      await git.command(f.directory, ['remote', 'add', name, join(root, name)])
    }
    const branch = (await git.inspect(f.directory)).branch
    await git.command(f.directory, ['push', '--set-upstream', 'fetch', branch])
    await git.command(f.directory, ['config', 'remote.pushDefault', 'default'])
    await git.push(f.directory)
    expect(
      (await git.command(join(root, 'default'), ['rev-parse', `refs/heads/${branch}`])).trim(),
    ).toBe((await git.command(f.directory, ['rev-parse', 'HEAD'])).trim())
    await git.command(f.directory, ['config', `branch.${branch}.pushRemote`, 'branch'])
    await git.push(f.directory)
    expect(
      (await git.command(join(root, 'branch'), ['rev-parse', `refs/heads/${branch}`])).trim(),
    ).toBe((await git.command(f.directory, ['rev-parse', 'HEAD'])).trim())
    expect((await git.command(f.directory, ['config', `branch.${branch}.remote`])).trim()).toBe(
      'fetch',
    )
    await git.command(f.directory, ['branch', 'local-base'])
    await git.command(f.directory, ['branch', '--set-upstream-to=local-base', branch])
    await git.push(f.directory)
    expect((await git.command(f.directory, ['config', `branch.${branch}.remote`])).trim()).toBe('.')
  } finally {
    await f.cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
it('lets Git apply pushurl while fetch still uses its own URL', async () => {
  const f = await fixture()
  const root = await mkdtemp(join(tmpdir(), 'dovo-push-url-'))
  const git = new GitService()
  try {
    for (const name of ['fetch', 'push'])
      await git.command(root, ['init', '--bare', '-q', join(root, name)])
    const branch = (await git.inspect(f.directory)).branch
    await git.command(f.directory, ['remote', 'add', 'origin', join(root, 'fetch')])
    await git.command(f.directory, ['remote', 'set-url', '--push', 'origin', join(root, 'push')])
    await git.push(f.directory)
    expect(
      (await git.command(join(root, 'push'), ['rev-parse', `refs/heads/${branch}`])).trim(),
    ).toBe((await git.command(f.directory, ['rev-parse', 'HEAD'])).trim())
    expect((await git.command(f.directory, ['remote', 'get-url', 'origin'])).trim()).toBe(
      join(root, 'fetch'),
    )
    expect(
      (await git.command(root, ['--git-dir', join(root, 'fetch'), 'for-each-ref'])).trim(),
    ).toBe('')
  } finally {
    await f.cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
