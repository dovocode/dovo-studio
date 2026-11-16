import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'assemble-fragments.mjs')

await test('release moves fragments into CHANGELOG.md, and notes reads the section back', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-changelog-assemble-'))
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })
  try {
    await mkdir(join(cwd, 'changelog.d'))
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ version: '1.2.0' }))
    await writeFile(join(cwd, 'changelog.d/README.md'), '# Format\n')
    await writeFile(
      join(cwd, 'changelog.d/8.md'),
      '---\ncategory: Added\nclients: mobile\n---\nShare threads from the phone.\n',
    )
    await writeFile(
      join(cwd, 'changelog.d/fix-sync.md'),
      '---\ncategory: Fixed\nclients: desktop, web\n---\nDrafts sync after a reconnect.\n',
    )

    const preview = run('preview')
    assert.equal(preview.status, 0)
    assert.match(preview.stdout, /- Mobile: Share threads from the phone\. \(#8\)/)
    assert.deepEqual((await readdir(join(cwd, 'changelog.d'))).length, 3)

    const release = run('release', '--date', '2026-11-16')
    assert.equal(release.status, 0, release.stderr)
    assert.deepEqual(await readdir(join(cwd, 'changelog.d')), ['README.md'])
    const changelog = await readFile(join(cwd, 'CHANGELOG.md'), 'utf8')
    assert.match(changelog, /^# Changelog\n/)
    assert.match(changelog, /## 1\.2\.0 \(2026-11-16\)\n\n### Added\n/)

    const notes = run('notes', '1.2.0')
    assert.equal(
      notes.stdout,
      '### Added\n\n- Mobile: Share threads from the phone. (#8)\n\n### Fixed\n\n- Desktop, web: Drafts sync after a reconnect.\n',
    )
    assert.equal(run('notes', '9.9.9').stdout, '')

    const empty = run('release', '1.3.0')
    assert.equal(empty.status, 1)
    assert.match(empty.stderr, /No fragments/)

    await writeFile(
      join(cwd, 'changelog.d/9.md'),
      '---\ncategory: Fixed\nclients: web\n---\nAnother fix.\n',
    )
    const duplicate = run('release', '1.2.0')
    assert.equal(duplicate.status, 1)
    assert.match(duplicate.stderr, /already has a section for 1\.2\.0/)
    assert.deepEqual((await readdir(join(cwd, 'changelog.d'))).toSorted(), ['9.md', 'README.md'])

    await writeFile(join(cwd, 'changelog.d/bad.md'), 'no header\n')
    const invalid = run('release', '1.3.0')
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /changelog\.d\/bad\.md/)
    assert.ok((await readdir(join(cwd, 'changelog.d'))).includes('9.md'))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
