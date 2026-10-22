import { decode } from '@dovo/protocol'
import { expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from '../../git/git'
import { commandsSchema } from '@dovo/protocol'
it('never follows an authenticated Git redirect outside a connected repository', async () => {
  const requests: Array<{
    path: string
    authorization?: string
  }> = []
  const server = createServer((request, response) => {
    requests.push({
      path: request.url ?? '',
      authorization: request.headers.authorization,
    })
    response.writeHead(302, {
      location: '/outside/repo.git/info/refs?service=git-upload-pack',
    })
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const directory = await mkdtemp(join(tmpdir(), 'dovo-forge-git-'))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    await expect(
      new GitService().cloneRemote(
        {
          name: 'repo',
          cloneUrl: `http://127.0.0.1:${address.port}/org/repo.git`,
        },
        directory,
        'Basic fixture-only-token',
      ),
    ).rejects.toThrow('Could not clone')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({
      path: '/org/repo.git/info/refs?service=git-upload-pack',
      authorization: 'Basic fixture-only-token',
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
it('fetches a GitHub PR with its selected connection from the task checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-forge-github-fetch-'))
  try {
    const command = join(directory, 'git.cjs')
    const authorization = 'Basic fixture-selected-profile'
    await writeFile(
      command,
      `#!/usr/bin/env node
if (process.cwd() !== require('node:fs').realpathSync(${JSON.stringify(directory)})) process.exit(9);
if (process.env.GIT_CONFIG_VALUE_0 !== ${JSON.stringify(`Authorization: ${authorization}`)}) process.exit(10);
if (process.argv.some(arg => arg.includes('git-credential') || arg.includes(${JSON.stringify(authorization)}))) process.exit(11);
`,
      {
        mode: 0o700,
      },
    )
    const authenticate = vi
      .fn<(id: string, remote: string, cwd: string) => Promise<string>>()
      .mockResolvedValue(authorization)
    const audit = vi.fn<NonNullable<ConstructorParameters<typeof GitService>[1]>>()
    const git = new GitService(
      () =>
        decode(commandsSchema, {
          git: command,
        }),
      audit,
      authenticate,
    )
    await git.fetchPull(directory, 'https://github.com/team/app', 3, 'refs/dovo/pr-3', {
      provider: 'github',
      connectionId: 'github-selected',
      number: 3,
      url: 'https://github.com/team/app/pull/3',
      repositoryUrl: 'https://github.com/team/app',
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
    })
    expect(authenticate).toHaveBeenCalledExactlyOnceWith(
      'github-selected',
      'https://github.com/team/app.git',
      directory,
    )
    expect(JSON.stringify(audit.mock.calls)).not.toContain(authorization)
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    })
  }
})
it('refreshes force-pushed attribute cache refs without forcing user branch refs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-force-pull-'))
  const wrapper = join(directory, 'git-wrapper.cjs')
  await writeFile(
    wrapper,
    `#!/usr/bin/env node
const child = require('node:child_process').spawnSync('git', ['-c', ${JSON.stringify('url.' + directory + '.insteadOf=http://fixture.example/repo.git')}, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(child.status ?? 1);
`,
    { mode: 0o700 },
  )
  const git = new GitService(() => decode(commandsSchema, { git: wrapper }))
  try {
    await git.command(directory, ['init'])
    await git.command(directory, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'old',
    ])
    const old = (await git.command(directory, ['rev-parse', 'HEAD'])).trim()
    await git.command(directory, ['update-ref', 'refs/dovo/pull-attributes/7', old])
    await git.command(directory, ['update-ref', 'refs/heads/user-pr', old])
    await git.command(directory, ['checkout', '--orphan', 'replacement'])
    await git.command(directory, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'rewritten',
    ])
    const head = (await git.command(directory, ['rev-parse', 'HEAD'])).trim()
    const source = {
      provider: 'gitea' as const,
      number: 7,
      url: 'https://forge.example/o/r/pulls/7',
      repositoryUrl: 'https://forge.example/o/r',
      headSha: head,
      baseSha: old,
      cloneUrl: 'http://fixture.example/repo.git',
      headRef: 'refs/heads/replacement',
    }
    await git.fetchPull(
      directory,
      'https://forge.example/o/r',
      7,
      'refs/dovo/pull-attributes/7',
      source,
    )
    expect(
      (await git.command(directory, ['rev-parse', 'refs/dovo/pull-attributes/7'])).trim(),
    ).toBe(head)
    await expect(
      git.fetchPull(directory, 'https://forge.example/o/r', 7, 'refs/heads/user-pr', source),
    ).rejects.toThrow('non-fast-forward')
    expect((await git.command(directory, ['rev-parse', 'refs/heads/user-pr'])).trim()).toBe(old)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
