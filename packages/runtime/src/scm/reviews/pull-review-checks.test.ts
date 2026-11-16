import { afterEach, expect, it } from 'vite-plus/test'
import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { GitService } from '../git/git.js'
import { fixture } from '../../testing/fixture.js'
import { pullCheckCommands, runPullCheckCommand, runPullChecks } from './pull-review-checks.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

it('selects fixed scripts and uses frozen installs for known package managers', () => {
  const plan = pullCheckCommands(
    {
      packageManager: 'pnpm@12.18.0',
      scripts: { check: 'check', lint: 'lint', fallow: 'fallow', 'fallow:ci': 'ci', test: 'test' },
    },
    [],
  )
  expect(plan.install).toEqual(['install', '--frozen-lockfile'])
  expect(plan.scripts.map((item) => item.script)).toEqual([
    undefined,
    'check',
    undefined,
    'lint',
    'fallow:ci',
    'test',
  ])
  expect(pullCheckCommands({}, ['package-lock.json']).install).toEqual(['ci'])
  expect(pullCheckCommands({ packageManager: 'yarn@4.1.0' }, []).install).toEqual([
    'install',
    '--immutable',
  ])
  expect(() => pullCheckCommands({ packageManager: 'malicious-command@1' }, [])).toThrow(
    'Unsupported package manager',
  )
})

it('captures real exit codes, bounded output, cancellation and timeout', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const signal = new AbortController().signal
  const failed = await runPullCheckCommand(
    process.execPath,
    ['-e', 'console.log("lint failed");process.exit(7)'],
    f.directory,
    signal,
  )
  expect(failed).toMatchObject({
    status: 'failed',
    exitCode: 7,
    output: expect.stringContaining('lint failed'),
  })
  const large = await runPullCheckCommand(
    process.execPath,
    ['-e', 'process.stdout.write("x".repeat(100000))'],
    f.directory,
    signal,
  )
  expect(large.status).toBe('passed')
  expect(large.output.length).toBeLessThanOrEqual(20000)
  expect(large.output).toContain('truncated')
  const controller = new AbortController()
  const pending = runPullCheckCommand(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    f.directory,
    controller.signal,
  )
  controller.abort()
  expect((await pending).status).toBe('cancelled')
  expect(
    (
      await runPullCheckCommand(
        process.execPath,
        ['-e', 'setInterval(()=>{},1000)'],
        f.directory,
        signal,
        50,
      )
    ).status,
  ).toBe('timed-out')
})

it('runs install, lint, Fallow and tests at the captured commit without touching dirty user files', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const git = new GitService()
  await writeFile(
    join(f.directory, 'package.json'),
    JSON.stringify({
      name: 'review-fixture',
      version: '1.0.0',
      scripts: {
        postinstall: 'node -e "console.log(\'installed fixture\')"',
        check:
          "node -e \"if(require('fs').readFileSync('hello.txt','utf8')!=='original\\n')process.exit(1);console.log(process.cwd())\"",
        lint: 'node -e "console.error(\'real lint failure\');process.exit(3)"',
        'fallow:ci': 'node -e "console.log(\'dead-code result\')"',
        test: 'node -e "console.log(\'test passed\')"',
      },
    }),
  )
  await writeFile(
    join(f.directory, 'package-lock.json'),
    JSON.stringify({
      name: 'review-fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'review-fixture', version: '1.0.0', hasInstallScript: true } },
    }),
  )
  await git.command(f.directory, ['add', '.'])
  await git.command(f.directory, ['commit', '-qm', 'Verification fixture'])
  const headSha = (await git.command(f.directory, ['rev-parse', 'HEAD'])).trim()
  await writeFile(join(f.directory, 'hello.txt'), 'dirty user file')
  const updates: string[][] = []
  const checks = await runPullChecks({
    repository: f.directory,
    headSha,
    git,
    signal: new AbortController().signal,
    progress: (checks) => updates.push(checks.map((check) => check.status)),
  })
  expect(checks.map((check) => [check.name, check.status])).toEqual([
    ['Install dependencies', 'passed'],
    ['build', 'skipped'],
    ['check', 'passed'],
    ['typecheck', 'skipped'],
    ['lint', 'failed'],
    ['fallow:ci', 'passed'],
    ['test:ci', 'passed'],
  ])
  expect(checks.find((check) => check.name === 'lint')).toMatchObject({
    exitCode: 3,
    output: expect.stringContaining('real lint failure'),
  })
  expect(checks.every((check) => check.headSha === headSha)).toBe(true)
  expect(updates.some((statuses) => statuses.includes('running'))).toBe(true)
  const checkout = checks
    .find((check) => check.name === 'check')
    ?.output.trim()
    .split('\n')
    .at(-1)
  expect(checkout).toContain('dovo-pr-checks-')
  if (!checkout) throw new Error('Missing checkout output')
  await expect(access(checkout)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(f.directory, 'hello.txt'), 'utf8')).toBe('dirty user file')
  expect((await git.command(f.directory, ['rev-parse', 'HEAD'])).trim()).toBe(headSha)
}, 30000)

it('reports URL-only or unavailable commits without inventing command evidence', async () => {
  const git = new GitService()
  const signal = new AbortController().signal
  const url = await runPullChecks({ headSha: 'a'.repeat(40), git, signal, progress: () => {} })
  expect(url).toMatchObject([
    { status: 'skipped', output: expect.stringContaining('local Git project') },
  ])
  const f = await fixture()
  cleanups.push(f.cleanup)
  const unavailable = await runPullChecks({
    repository: f.directory,
    headSha: 'a'.repeat(40),
    git,
    signal,
    progress: () => {},
  })
  expect(unavailable).toMatchObject([{ status: 'skipped' }])
})
