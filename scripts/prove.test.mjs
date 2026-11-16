import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { testRunner, unloadedFiles } from './prove.mjs'

const script = join(dirname(fileURLToPath(import.meta.url)), 'prove.mjs')
const lockfile = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .: {}
`

// A repository whose main branch has a bug and whose current branch fixes it.
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-prove-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Fixture')
  git('config', 'user.email', 'fixture@example.com')
  await writeFile(join(cwd, 'package.json'), '{"name":"fixture","private":true}\n')
  await writeFile(join(cwd, 'pnpm-lock.yaml'), lockfile)
  await writeFile(join(cwd, '.gitignore'), 'node_modules/\n')
  await writeFile(join(cwd, 'add.mjs'), 'export const add = (a, b) => a - b\n')
  git('add', '.')
  git('commit', '-m', 'Add with a bug')
  git('checkout', '-b', 'fix')
  await writeFile(join(cwd, 'add.mjs'), 'export const add = (a, b) => a + b\n')
  git('commit', '-am', 'Fix add')
  const state = () => ({
    status: git('status', '--porcelain=v1', '--untracked-files=all'),
    worktrees: git('worktree', 'list', '--porcelain'),
    stash: git('stash', 'list'),
  })
  const proveDirectory = join(cwd, '..', `${basename(cwd)}-worktrees`)
  const leftovers = async () => readdir(proveDirectory).catch(() => [])
  const env = { ...process.env, INIT_CWD: cwd, DOVO_PROVE_DIR: proveDirectory }
  const cleanup = () =>
    Promise.all([cwd, proveDirectory].map((path) => rm(path, { recursive: true, force: true })))
  return { cwd, state, leftovers, env, cleanup }
}

const testFile = (assertion) =>
  `import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { add } from './add.mjs'\ntest('add', async () => { ${assertion} })\n`

await test('test files choose node or vitest; other files are only copied', () => {
  assert.equal(testRunner('scripts/changelog/fragments.test.mjs'), 'node')
  assert.equal(testRunner('packages/runtime/src/agents/catalogs/codex.test.ts'), 'vitest')
  assert.equal(testRunner('apps/web/src/view.test.tsx'), 'vitest')
  assert.equal(testRunner('packages/runtime/src/testing/helper.ts'), undefined)
})

await test('prove reports fail-on-base and pass-on-head without touching the working tree', async () => {
  const { cwd, state, leftovers, env, cleanup } = await fixture()
  try {
    await writeFile(join(cwd, 'add.test.mjs'), testFile('assert.equal(add(1, 2), 3)'))
    const before = state()
    const result = spawnSync(process.execPath, [script, '--', 'add.test.mjs'], {
      cwd,
      encoding: 'utf8',
      env,
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /base [0-9a-f]{10} \(merge-base with main\): failed, as expected/)
    assert.match(result.stdout, /this checkout: passed, as expected/)
    assert.match(result.stdout, /Proven/)
    assert.deepEqual(state(), before)
    assert.deepEqual(await leftovers(), [])

    await writeFile(join(cwd, 'add.test.mjs'), testFile('assert.equal(add(0, 0), 0)'))
    const weak = spawnSync(process.execPath, [script, 'add.test.mjs', '--base', 'main'], {
      cwd,
      encoding: 'utf8',
      env,
    })
    assert.equal(weak.status, 1)
    assert.match(weak.stdout, /passed, but it should fail/)
    assert.match(weak.stdout, /Not proven/)

    const helperOnly = spawnSync(process.execPath, [script, 'add.mjs'], {
      cwd,
      encoding: 'utf8',
      env,
    })
    assert.equal(helperOnly.status, 2)
    assert.match(helperOnly.stderr, /None of the files is a \*\.test\.\* file/)
    assert.deepEqual(await leftovers(), [])
  } finally {
    await cleanup()
  }
})

await test('load failures are told apart from failing tests for both runners', () => {
  const nodeLoad = [
    "SyntaxError: The requested module './add.mjs' does not provide an export named 'subtract'",
    '✖ scripts/add.test.mjs (28.4ms)',
    'ℹ tests 1',
    '✖ failing tests:',
    'test at scripts/add.test.mjs:1:1',
    '✖ scripts/add.test.mjs (28.4ms)',
    "  'test failed'",
  ].join('\n')
  assert.deepEqual(
    unloadedFiles('node', ['scripts/add.test.mjs', 'scripts/other.test.mjs'], nodeLoad),
    ['scripts/add.test.mjs'],
  )
  const nodeAssertion = ['✖ adds numbers (0.7ms)', 'AssertionError [ERR_ASSERTION]: -1 == 3'].join(
    '\n',
  )
  assert.deepEqual(unloadedFiles('node', ['scripts/add.test.mjs'], nodeAssertion), [])

  const vitestLoad = [
    ' FAIL  packages/a/src/view.test.ts [ packages/a/src/view.test.ts ]',
    "Error: Cannot find module './missing' imported from packages/a/src/view.test.ts",
    ' Test Files  1 failed (1)',
    '      Tests  no tests',
  ].join('\n')
  assert.deepEqual(unloadedFiles('vitest', ['packages/a/src/view.test.ts'], vitestLoad), [
    'packages/a/src/view.test.ts',
  ])
  const vitestAssertion = [
    ' FAIL  packages/a/src/view.test.ts > renders the title',
    'AssertionError: expected 1 to be 2',
  ].join('\n')
  assert.deepEqual(unloadedFiles('vitest', ['packages/a/src/view.test.ts'], vitestAssertion), [])
})

await test('prove does not count a test that cannot load on the base as proof', async () => {
  const { cwd, state, leftovers, env, cleanup } = await fixture()
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  try {
    // The fix branch adds a new export. The base fails only because the import is missing.
    await writeFile(
      join(cwd, 'add.mjs'),
      'export const add = (a, b) => a + b\nexport const double = (a) => a * 2\n',
    )
    git('commit', '-am', 'Add double')
    await writeFile(
      join(cwd, 'double.test.mjs'),
      "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { double } from './add.mjs'\ntest('double', () => { assert.equal(double(2), 4) })\n",
    )
    const before = state()
    const result = spawnSync(process.execPath, [script, 'double.test.mjs'], {
      cwd,
      encoding: 'utf8',
      env,
    })
    assert.equal(result.status, 3, result.stdout + result.stderr)
    assert.match(
      result.stdout,
      /base [0-9a-f]{10} \(merge-base with main\): could not load double\.test\.mjs/,
    )
    assert.match(result.stdout, /this checkout: passed, as expected/)
    assert.match(result.stdout, /Not proven: the test could not load on the base/)
    assert.doesNotMatch(result.stdout, /^Proven/m)
    assert.deepEqual(state(), before)
    assert.deepEqual(await leftovers(), [])
  } finally {
    await cleanup()
  }
})

await test('prove removes the base worktree when it is interrupted', async () => {
  const { cwd, state, leftovers, env, cleanup } = await fixture()
  try {
    // The bug makes the base run hang, so the interrupt arrives while tests run there.
    await writeFile(
      join(cwd, 'add.test.mjs'),
      testFile('if (add(1, 2) !== 3) await new Promise((resolve) => setTimeout(resolve, 60_000))'),
    )
    const before = state()
    const child = spawn(process.execPath, [script, 'add.test.mjs'], {
      cwd,
      env,
    })
    let output = ''
    const exit = new Promise((resolve) => child.on('close', resolve))
    await new Promise((resolve) => {
      child.stdout.on('data', (chunk) => {
        output += chunk
        if (output.includes('running tests on the base')) resolve()
      })
    })
    assert.equal((await leftovers()).length, 1)
    child.kill('SIGINT')
    assert.equal(await exit, 130)
    assert.match(output, /SIGINT received/)
    assert.deepEqual(state(), before)
    assert.deepEqual(await leftovers(), [])
  } finally {
    await cleanup()
  }
})
