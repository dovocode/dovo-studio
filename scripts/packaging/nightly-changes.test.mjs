import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nightlyChanges } from './nightly-changes.mjs'

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
