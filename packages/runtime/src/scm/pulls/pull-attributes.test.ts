import { expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decode, pullDetailSchema, type PullDetail } from '@dovo/protocol'
import { GitService } from '../git/git'
import { pullAttributes } from './pull-attributes'

function detail(headSha: string, paths: string[]): PullDetail {
  return decode(pullDetailSchema, {
    pull: {
      number: 7,
      title: 'PR',
      url: 'https://github.com/a/b/pull/7',
      repositoryUrl: 'https://github.com/a/b',
      state: 'open',
      draft: false,
      author: 'dev',
      updatedAt: '2026-10-12',
      head: 'feature',
      base: 'main',
      labels: [],
      headSha,
      baseSha: headSha,
      body: '',
      additions: 1,
      deletions: 0,
      changedFiles: paths.length,
      mergeable: true,
      reviewers: [],
      assignees: [],
    },
    files: paths.map((path) => ({
      path,
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: '@@ -1 +1 @@\n-old\n+new',
    })),
    comments: [],
    checks: [],
    warnings: [],
  })
}

it('honors revision-specific nested attributes, macros, negation and unusual paths without changing the checkout', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-attributes-test-'))
  const git = new GitService()
  try {
    await git.command(cwd, ['init', '-b', 'main'])
    await git.command(cwd, ['config', 'user.name', 'Test'])
    await git.command(cwd, ['config', 'user.email', 'test@example.test'])
    await mkdir(join(cwd, 'nested'))
    await writeFile(
      join(cwd, '.gitattributes'),
      '[attr]generated linguist-generated\n*.dat binary\n*.ts generated\nvendor/** linguist-vendored=true\n"space name.txt" -diff\n"line\\nname.txt" -diff\n',
    )
    await writeFile(
      join(cwd, 'nested/.gitattributes'),
      '*.ts -linguist-generated linguist-vendored\nplain.ts !linguist-generated -linguist-vendored diff\n',
    )
    await git.command(cwd, ['add', '.'])
    await git.command(cwd, ['commit', '-m', 'attributes'])
    const sha = (await git.command(cwd, ['rev-parse', 'HEAD'])).trim()
    await writeFile(join(cwd, '.gitattributes'), '* -diff linguist-generated linguist-vendored\n')
    await writeFile(
      join(cwd, '.git/info/attributes'),
      '* -diff linguist-generated linguist-vendored\n',
    )
    const status = await git.command(cwd, ['status', '--porcelain'])
    const input = detail(sha, [
      'blob.dat',
      'code.ts',
      'nested/code.ts',
      'nested/plain.ts',
      'vendor/library.js',
      'space name.txt',
      'line\nname.txt',
      'plain.txt',
    ])
    const result = await pullAttributes(git, cwd, input)
    expect(result.warnings).toEqual([])
    expect(result.files.map((file) => file.attributes)).toEqual([
      { binary: true, generated: false, vendored: false },
      { binary: false, generated: true, vendored: false },
      { binary: false, generated: false, vendored: true },
      { binary: false, generated: false, vendored: false },
      { binary: false, generated: false, vendored: true },
      { binary: true, generated: false, vendored: false },
      { binary: true, generated: false, vendored: false },
      { binary: false, generated: false, vendored: false },
    ])
    expect(result.files[0].patch).toBe(input.files[0].patch)
    expect(await git.command(cwd, ['status', '--porcelain'])).toBe(status)
    expect((await git.command(cwd, ['rev-parse', 'HEAD'])).trim()).toBe(sha)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

it('fetches a missing PR revision once and reports attribute failures without losing diffs', async () => {
  const git = new GitService()
  const input = detail('a'.repeat(40), ['file.ts'])
  vi.spyOn(git, 'command').mockRejectedValue(new Error('Missing commit'))
  const fetch = vi.spyOn(git, 'fetchPull').mockRejectedValue(new Error('Offline'))
  const result = await pullAttributes(git, '/project', input)
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledWith(
    '/project',
    input.pull.repositoryUrl,
    7,
    'refs/dovo/pull-attributes/7',
    input.pull,
  )
  expect(result.files).toEqual(input.files)
  expect(result.warnings).toEqual(['File attributes: Could not read PR .gitattributes. Offline'])
  vi.restoreAllMocks()
})
