import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mobileSmokeRuntime } from './mobile-smoke-runtime.mjs'

await test('installed mobile smoke loads a separate previous checkout and rejects invalid baselines', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-runtime-smoke-'))
  try {
    const current = join(directory, 'current')
    const previous = join(directory, 'previous')
    await mkdir(current)
    const git = (cwd, ...args) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git(current, 'init', '--quiet')
    git(current, 'config', 'user.name', 'Mobile smoke fixture')
    git(current, 'config', 'user.email', 'mobile@example.test')
    await writeFile(join(current, 'package.json'), '{"type":"module"}')
    git(current, 'add', 'package.json')
    git(current, 'commit', '--quiet', '-m', 'First runtime')
    git(current, 'worktree', 'add', '--detach', previous, 'HEAD')
    await assert.rejects(mobileSmokeRuntime(current, previous), /different commit/)
    git(current, 'commit', '--quiet', '--allow-empty', '-m', 'New client')

    await assert.rejects(mobileSmokeRuntime(current, previous), /Build the previous/)
    for (const [checkout, value] of [
      [current, 'current'],
      [previous, 'previous'],
    ]) {
      const dist = join(checkout, 'packages/runtime/dist')
      await mkdir(dist, { recursive: true })
      await writeFile(
        join(dist, 'index.js'),
        `export function startRuntime() { return '${value}' }`,
      )
    }
    assert.equal((await mobileSmokeRuntime(current)).startRuntime(), 'current')
    assert.equal((await mobileSmokeRuntime(current, previous)).startRuntime(), 'previous')
    await writeFile(join(previous, 'package.json'), '{"type":"module","name":"dirty"}')
    await assert.rejects(mobileSmokeRuntime(current, previous), /clean checkout/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
