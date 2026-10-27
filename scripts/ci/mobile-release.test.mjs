import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mobileArtifactName,
  mobileBuildNumber,
  mobileReleaseTag,
  publishMobileRelease,
  requireMobileChecks,
  requireCurrentMobileRun,
} from './mobile-release.mjs'
await test('mobile releases require both check workflows for the exact source commit', () => {
  const sha = 'a'.repeat(40)
  const passed = { headSha: sha, status: 'completed', conclusion: 'success' }
  const calls = []
  requireMobileChecks(sha, (...args) => {
    calls.push(args)
    return JSON.stringify([passed])
  })
  assert.deepEqual(
    calls.map((args) => args[args.indexOf('--workflow') + 1]),
    ['check.yml', 'check-mobile.yml'],
  )
  assert.ok(calls.every((args) => args[args.indexOf('--commit') + 1] === sha))
  for (const failed of [
    undefined,
    { ...passed, status: 'in_progress' },
    { ...passed, conclusion: 'failure' },
    { ...passed, headSha: 'b'.repeat(40) },
  ])
    assert.throws(
      () =>
        requireMobileChecks(sha, (...args) =>
          JSON.stringify(args.includes('check.yml') ? [passed] : failed ? [failed] : []),
        ),
      /check-mobile.yml/,
    )
  assert.throws(() => requireMobileChecks(sha, () => '[]'), /check.yml/)
})
await test('mobile build sequence stays above manual builds and increases across runs and retries', () => {
  const first = Number(mobileBuildNumber('2026101902', '1', '1'))
  assert.ok(first > 2026101902)
  assert.ok(Number(mobileBuildNumber('2026101902', '1', '2')) > first)
  assert.ok(
    Number(mobileBuildNumber('2026101902', '2', '1')) >
      Number(mobileBuildNumber('2026101902', '1', '99')),
  )
  for (const values of [
    ['1', '0', '1'],
    ['1', '1', '100'],
    ['1', 'abc', '1'],
    ['2100000000', '1', '1'],
  ])
    assert.throws(() => mobileBuildNumber(...values))
})
await test('a superseded mobile rerun cannot upload a lower store build number', () => {
  const newerBuild = Number(mobileBuildNumber('2026101902', '2', '1'))
  const olderRetryBuild = Number(mobileBuildNumber('2026101902', '1', '2'))
  assert.ok(olderRetryBuild < newerBuild, 'An old retry would regress the store build number')
  const calls = []
  const gh = (...args) => {
    calls.push(args)
    return JSON.stringify([{ number: 2, databaseId: 200 }])
  }
  assert.throws(
    () => requireCurrentMobileRun({ runId: '100', runNumber: '1' }, gh),
    /superseded by run 2.*Dispatch a fresh Mobile beta release/,
  )
  assert.deepEqual(calls, [
    [
      'run',
      'list',
      '--workflow',
      'release-mobile.yml',
      '--limit',
      '1',
      '--json',
      'number,databaseId',
    ],
  ])
})
await test('failed, cancelled or incomplete newer releases block older retries after possible partial uploads', () => {
  for (const newer of [
    { status: 'completed', conclusion: 'failure', uploadedPlatforms: ['ios'] },
    { status: 'completed', conclusion: 'failure', uploadedPlatforms: ['android'] },
    { status: 'completed', conclusion: 'cancelled', uploadedPlatforms: ['ios', 'android'] },
    { status: 'in_progress', conclusion: null, uploadedPlatforms: ['ios'] },
    { status: 'queued', conclusion: null, uploadedPlatforms: [] },
  ]) {
    const gh = (...args) => {
      assert.equal(args.includes('--status'), false, 'Do not ignore failed/partial releases')
      return JSON.stringify([{ number: 2, databaseId: 200, ...newer }])
    }
    assert.throws(() => requireCurrentMobileRun({ runId: '100', runNumber: '1' }, gh), /superseded/)
  }
})
await test('the latest mobile run can retry and resume, while missing or mismatched run metadata fails closed', () => {
  const current = { runId: '200', runNumber: '2' }
  requireCurrentMobileRun(current, () => JSON.stringify([{ number: 2, databaseId: 200 }]))
  for (const latest of [
    undefined,
    { number: 1, databaseId: 100 },
    { number: 2, databaseId: 201 },
    { number: '2', databaseId: 200 },
    { number: 2 },
  ])
    assert.throws(
      () => requireCurrentMobileRun(current, () => JSON.stringify(latest ? [latest] : [])),
      /Cannot verify/,
    )
  assert.throws(
    () =>
      requireCurrentMobileRun(current, () => {
        throw new Error('GitHub unavailable')
      }),
    /GitHub unavailable/,
  )
  for (const identity of [
    { runId: '', runNumber: '2' },
    { runId: '200', runNumber: 'NaN' },
  ])
    assert.throws(() => requireCurrentMobileRun(identity, () => '[]'), /Invalid mobile workflow/)
})
await test('allocation, failed-job build guards and publication reject old reruns before reading signed artifacts', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-mobile-run-guard-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(
    join(directory, 'gh'),
    `#!${process.execPath}
const fs=require('node:fs');
fs.appendFileSync(process.env.MOBILE_GH_CALLS, JSON.stringify(process.argv.slice(2))+'\\n');
console.log(JSON.stringify([{number:2,databaseId:200}]));
`,
    { mode: 0o700 },
  )
  const output = join(directory, 'output')
  for (const command of [[], ['current'], ['publish']]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./mobile-release.mjs', import.meta.url)), ...command],
      {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: directory + delimiter + process.env.PATH,
          MOBILE_GH_CALLS: join(directory, 'calls.jsonl'),
          GITHUB_RUN_ID: '100',
          GITHUB_RUN_NUMBER: '1',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_OUTPUT: output,
        },
      },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /superseded by run 2.*Dispatch a fresh Mobile beta release/)
  }
  assert.equal(existsSync(output), false, 'A superseded run must not allocate a store number')
  const calls = readFileSync(join(directory, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(calls.length, 3)
  assert.ok(calls.every((args) => args[0] === 'run' && args[1] === 'list'))
})
await test('mobile tags use the mobile marketing version and cannot trigger desktop version tags', () => {
  assert.equal(mobileReleaseTag('1.2.3', '2026102003'), 'mobile-v1.2.3-beta.2026102003')
  assert.equal(mobileArtifactName('1.2.3', '42', 'ios'), 'Dovo-Studio-Mobile-1.2.3-beta.42-ios.ipa')
  assert.equal(
    mobileArtifactName('1.2.3', '42', 'android'),
    'Dovo-Studio-Mobile-1.2.3-beta.42-android.aab',
  )
  for (const [version, build] of [
    ['v1.2.3', '1'],
    ['1.2.3-nightly.1', '1'],
    ['1.2.3', '0'],
    ['1.2.3', '2100000001'],
    ['1.2.3', '1\nother'],
  ])
    assert.throws(() => mobileReleaseTag(version, build))
  assert.throws(() => mobileArtifactName('1.2.3', '1', 'desktop'))
})

function fixture(t, platform = 'all') {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-mobile-release-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const options = { version: '1.2.3', build: '42', sha: 'a'.repeat(40), platform, directory }
  const tag = mobileReleaseTag(options.version, options.build)
  const files = []
  for (const target of platform === 'all' ? ['ios', 'android'] : [platform]) {
    const file = join(directory, mobileArtifactName(options.version, options.build, target))
    const bytes = Buffer.from('Signed ' + target + ' fixture')
    writeFileSync(file, bytes)
    writeFileSync(
      `${file}.json`,
      JSON.stringify({
        version: options.version,
        build: options.build,
        platform: target,
        commit: options.sha,
        releaseTag: tag,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    )
    files.push(file, `${file}.json`)
  }
  const calls = []
  const state = { release: null, failUpload: false }
  const gh = (...args) => {
    calls.push(args)
    if (args[1] === 'list')
      return JSON.stringify([
        { tagName: 'v9.0.0-nightly.42' },
        ...(state.release ? [{ tagName: tag }] : []),
      ])
    if (args[1] === 'view') return JSON.stringify(state.release)
    if (args[1] === 'create')
      state.release = { targetCommitish: options.sha, isDraft: true, isPrerelease: true }
    if (args[1] === 'upload' && state.failUpload) throw new Error('Upload failed')
    if (args[1] === 'edit') state.release.isDraft = false
    return ''
  }
  return { options, tag, files, calls, state, gh }
}

await test('publishes one independent mobile prerelease with both verified platform builds', (t) => {
  const f = fixture(t)
  assert.equal(publishMobileRelease(f.options, f.gh), f.tag)
  assert.equal(f.state.release.isDraft, false)
  const create = f.calls.find((args) => args[1] === 'create')
  assert.equal(create[2], f.tag)
  assert.ok(create.includes('--latest=false'))
  assert.ok(create.includes('--prerelease'))
  assert.ok(create.includes(f.options.sha))
  assert.deepEqual(f.calls.find((args) => args[1] === 'upload').slice(3, -1), f.files)
  const edit = f.calls.find((args) => args[1] === 'edit')
  assert.ok(edit.includes('--latest=false'))
  assert.ok(edit.includes('--prerelease'))
  assert.equal(
    f.calls.some((args) => args[0] === 'workflow'),
    false,
  )
  f.calls.length = 0
  publishMobileRelease(f.options, f.gh)
  assert.deepEqual(
    f.calls.map((args) => args[1]),
    ['list', 'view'],
    'Published releases are immutable on retry',
  )
})

await test('a single-platform release can resume its own draft after an upload failure', (t) => {
  const f = fixture(t, 'ios')
  f.state.failUpload = true
  assert.throws(() => publishMobileRelease(f.options, f.gh), /Upload failed/)
  assert.equal(f.state.release.isDraft, true)
  assert.equal(
    f.calls.some((args) => args[1] === 'edit'),
    false,
  )
  f.calls.length = 0
  f.state.failUpload = false
  publishMobileRelease(f.options, f.gh)
  assert.equal(f.state.release.isDraft, false)
  assert.equal(
    f.calls.some((args) => args[1] === 'create'),
    false,
  )
  assert.deepEqual(f.calls.find((args) => args[1] === 'upload').slice(3, -1), f.files)
})

await test('refuses changed artifacts, source mismatches and missing platforms before publication', (t) => {
  const f = fixture(t, 'android')
  f.state.release = { targetCommitish: 'b'.repeat(40), isDraft: true, isPrerelease: true }
  assert.throws(() => publishMobileRelease(f.options, f.gh), /does not match/)
  assert.equal(
    f.calls.some((args) => ['upload', 'edit'].includes(args[1])),
    false,
  )
  f.calls.length = 0
  const bytes = readFileSync(f.files[0])
  writeFileSync(f.files[0], 'Changed build')
  assert.throws(() => publishMobileRelease(f.options, f.gh), /provenance/)
  assert.deepEqual(f.calls, [])
  writeFileSync(f.files[0], bytes)
  assert.throws(() => publishMobileRelease({ ...f.options, platform: 'all' }, f.gh), /ENOENT/)
  assert.deepEqual(f.calls, [])
})
