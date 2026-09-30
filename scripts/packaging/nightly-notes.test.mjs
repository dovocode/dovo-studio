import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nightlyNotes } from './nightly-notes.mjs'
await test('nightly notes include commits since the last published ancestor, skipping drafts and other branches', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-nightly-notes-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.com')
    const commit = async (message) => {
      await writeFile(join(cwd, 'file'), message)
      git('add', 'file')
      git('commit', '-m', message)
      return git('rev-parse', 'HEAD')
    }
    await commit('Initial version')
    git('tag', 'v1.0.0-nightly.1')
    git('checkout', '-b', 'other')
    await commit('Unrelated branch')
    git('tag', 'v1.0.0-nightly.9')
    git('checkout', 'main')
    const first = await commit('Fix input [preview]')
    git('tag', 'v1.0.0-nightly.2')
    const last = await commit('Improve updates')
    const notes = nightlyNotes({
      cwd,
      target: last,
      repository: 'dovocode/dovo-studio',
      releases: [
        { tagName: 'v1.0.0-nightly.2', isDraft: true },
        { tagName: 'v1.0.0-nightly.9', isDraft: false },
        { tagName: 'v1.0.0-nightly.1', isDraft: false },
      ],
    })
    assert.ok(notes.includes('Fix input \\[preview\\]'))
    assert.ok(notes.includes(`/commit/${first}`))
    assert.ok(notes.includes('Improve updates'))
    assert.ok(!notes.includes('Initial version'))
    assert.ok(!notes.includes('Unrelated branch'))
    assert.ok(notes.includes(`/compare/v1.0.0-nightly.1...${last}`))
    assert.ok(
      nightlyNotes({
        cwd,
        target: last,
        repository: 'dovocode/dovo-studio',
        releases: [],
      }).includes('Initial version'),
    )
    git('tag', 'v1.0.0-nightly.3')
    assert.ok(
      nightlyNotes({
        cwd,
        target: last,
        repository: 'dovocode/dovo-studio',
        releases: [{ tagName: 'v1.0.0-nightly.3', isDraft: false }],
      }).includes('No new commits'),
    )
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
