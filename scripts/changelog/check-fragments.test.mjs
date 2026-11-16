import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fragmentRequirement } from './check-fragments.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-fragments.mjs')

await test('a fragment is required only for product changes and only counts when added', () => {
  assert.deepEqual(
    fragmentRequirement([
      { status: 'M', path: 'apps/web/src/app.tsx' },
      { status: 'A', path: 'apps/web/src/app.test.tsx' },
      { status: 'D', path: 'changelog.d/7.md' },
      { status: 'A', path: 'changelog.d/README.md' },
    ]),
    { required: true, hasFragment: false, paths: ['apps/web/src/app.tsx'] },
  )
  assert.deepEqual(
    fragmentRequirement([
      { status: 'D', path: 'packages/runtime/src/old.ts' },
      { status: 'A', path: 'changelog.d/fix-titles.md' },
    ]),
    { required: true, hasFragment: true, paths: ['packages/runtime/src/old.ts'] },
  )
  // An edit to another change's fragment does not cover this change.
  assert.equal(
    fragmentRequirement([
      { status: 'M', path: 'packages/runtime/src/tasks.ts' },
      { status: 'M', path: 'changelog.d/fix-titles.md' },
    ]).hasFragment,
    false,
  )
  // `--no-renames` lists a rename as a deletion and an addition; the new name counts.
  assert.equal(
    fragmentRequirement([
      { status: 'M', path: 'packages/runtime/src/tasks.ts' },
      { status: 'D', path: 'changelog.d/fix-titles.md' },
      { status: 'A', path: 'changelog.d/123.md' },
    ]).hasFragment,
    true,
  )
  assert.equal(fragmentRequirement([{ status: 'M', path: 'docs/architecture.md' }]).required, false)
})

await test('the check validates fragments and explains how to fix a missing fragment', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-changelog-check-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const check = (...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.com')
    await mkdir(join(cwd, 'apps/web/src'), { recursive: true })
    await mkdir(join(cwd, 'changelog.d'))
    await writeFile(join(cwd, 'changelog.d/README.md'), '# Format\n')
    await writeFile(join(cwd, 'apps/web/src/app.ts'), 'export const value = 1\n')
    git('add', '.')
    git('commit', '-m', 'Initial')
    const base = git('rev-parse', 'HEAD')

    assert.equal(check().status, 0)
    await writeFile(join(cwd, 'apps/web/src/app.ts'), 'export const value = 2\n')
    git('commit', '-am', 'Change app')
    const missing = check('--base', base)
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /adds no changelog fragment/)
    assert.match(missing.stderr, /apps\/web\/src\/app\.ts/)
    assert.match(missing.stderr, /skip-changelog label/)

    await writeFile(join(cwd, 'changelog.d/12.md'), '---\ncategory: Fixed\n---\n')
    git('add', '.')
    git('commit', '-m', 'Add broken fragment')
    const invalid = check('--base', base)
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /changelog\.d\/12\.md:\n {2}- set "clients:"/)

    await writeFile(
      join(cwd, 'changelog.d/12.md'),
      '---\ncategory: Fixed\nclients: web\n---\nThe value is right.\n',
    )
    git('commit', '-am', 'Fix fragment')
    const valid = check('--base', base)
    assert.equal(valid.status, 0, valid.stderr)
    assert.match(valid.stdout, /1 valid/)
    assert.match(valid.stdout, /adds a changelog fragment/)

    // A later change that only edits the existing fragment still needs its own.
    const withFragment = git('rev-parse', 'HEAD')
    await writeFile(join(cwd, 'apps/web/src/app.ts'), 'export const value = 3\n')
    await writeFile(
      join(cwd, 'changelog.d/12.md'),
      '---\ncategory: Fixed\nclients: web\n---\nThe value is right again.\n',
    )
    git('commit', '-am', 'Change app and edit the old fragment')
    const edited = check('--base', withFragment)
    assert.equal(edited.status, 1)
    assert.match(edited.stderr, /adds no changelog fragment/)

    // Renaming the fragment to the pull request number keeps it valid and counts.
    git('mv', 'changelog.d/12.md', 'changelog.d/13.md')
    git('commit', '-m', 'Rename fragment')
    const renamed = check('--base', withFragment)
    assert.equal(renamed.status, 0, renamed.stderr)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
