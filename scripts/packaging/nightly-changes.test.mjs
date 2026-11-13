import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nightlyChanges } from './nightly-changes.mjs'

await test(
  'the CLI refreshes tags published after checkout',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-nightly-tag-race-'))
    const git = (cwd, ...args) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    try {
      const source = join(directory, 'source'),
        remote = join(directory, 'remote'),
        checkout = join(directory, 'checkout'),
        bin = join(directory, 'bin')
      await mkdir(source)
      await mkdir(bin)
      git(directory, 'init', '--bare', remote)
      git(source, 'init', '-b', 'main')
      git(source, 'config', 'user.name', 'Fixture')
      git(source, 'config', 'user.email', 'fixture@example.com')
      git(source, 'config', 'commit.gpgSign', 'false')
      await writeFile(join(source, 'app'), 'published')
      git(source, 'add', '.')
      git(source, 'commit', '-m', 'published source')
      const published = git(source, 'rev-parse', 'HEAD')
      await writeFile(join(source, 'app'), 'next nightly')
      git(source, 'commit', '-am', 'new source')
      git(source, 'remote', 'add', 'origin', remote)
      git(source, 'push', 'origin', 'main')
      git(directory, 'clone', '--branch', 'main', remote, checkout)
      git(source, '-c', 'tag.gpgSign=false', 'tag', 'v1.0.0-nightly.1', published)
      git(source, 'push', 'origin', 'refs/tags/v1.0.0-nightly.1')
      assert.notEqual(
        spawnSync('git', ['rev-parse', '--verify', 'refs/tags/v1.0.0-nightly.1'], { cwd: checkout })
          .status,
        0,
      )
      await writeFile(
        join(bin, 'gh'),
        `#!${process.execPath}\nconsole.log(JSON.stringify([{tagName:'v1.0.0-nightly.1',isDraft:false,publishedAt:'2026-11-09T00:00:00Z'}]))\n`,
        { mode: 0o700 },
      )
      const output = execFileSync(
        process.execPath,
        [new URL('./nightly-changes.mjs', import.meta.url).pathname, 'HEAD'],
        {
          cwd: checkout,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      assert.equal(output, 'true')
      assert.equal(git(checkout, 'rev-parse', 'refs/tags/v1.0.0-nightly.1'), published)
      git(checkout, 'tag', '-d', 'v1.0.0-nightly.1')
      const notes = execFileSync(
        process.execPath,
        [new URL('./nightly-notes.mjs', import.meta.url).pathname, 'HEAD'],
        {
          cwd: checkout,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            GH_REPO: 'dovocode/dovo-studio',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      assert.ok(notes.includes('new source'))
      assert.ok(!notes.includes('- published source'))
      assert.equal(git(checkout, 'rev-parse', 'refs/tags/v1.0.0-nightly.1'), published)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

await test(
  'the workflow stops when the change check fails',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-nightly-gate-'))
    try {
      const workflow = await readFile(
        new URL('../../.github/workflows/release-desktop.yml', import.meta.url),
        'utf8',
      )
      const guard = workflow.match(
        /CHANGES=\$\(node scripts\/packaging\/nightly-changes\.mjs[^\n]*\n[\s\S]*?\bfi\n/,
      )?.[0]
      assert.ok(guard, 'Execute the shipped change-check gate')
      await writeFile(join(directory, 'node'), '#!/bin/sh\nexit 17\n', { mode: 0o700 })
      const result = spawnSync('bash', ['-e', '-c', guard], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      })
      assert.equal(result.status, 17, result.stderr)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

await test('nightlies skip published and distribution-only commits, but include changes after failed drafts', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-nightly-changes-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const check = (releases) => nightlyChanges({ target: 'HEAD', releases, cwd })
  const commit = async (path, text) => {
    await writeFile(join(cwd, path), text)
    git('add', '.')
    git('commit', '-m', text)
  }
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.com')
    await commit('source', 'initial')
    assert.equal(check([]).build, true)
    git('tag', 'v1.0.0')
    const stable = { tagName: 'v1.0.0', isDraft: false }
    assert.equal(check([stable]).build, false)
    await mkdir(join(cwd, 'Formula'))
    await commit('Formula/dovo.rb', 'distribution')
    assert.equal(check([stable]).build, false)
    await commit('source', 'fix')
    git('tag', 'v1.0.0-nightly.1')
    const nightly = { tagName: 'v1.0.0-nightly.1', isDraft: false }
    assert.equal(check([{ ...nightly, isDraft: true }, stable]).build, true)
    assert.equal(check([nightly, stable]).build, false)
    git('checkout', '-b', 'other')
    await commit('source', 'other branch')
    git('tag', 'v1.0.0-nightly.2')
    git('checkout', 'main')
    assert.equal(check([{ tagName: 'v1.0.0-nightly.2', isDraft: false }, nightly]).build, false)
    await commit('source', 'new work')
    assert.equal(check([nightly]).build, true)
    assert.throws(() => check([{ tagName: 'v9.0.0', isDraft: false }]), /Cannot resolve release/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
