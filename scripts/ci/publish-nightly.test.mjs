import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { manifestName, releaseFiles } from '../packaging/desktop-release-manifest.mjs'
import { publicationPair, validatePublication } from './publish-nightly.mjs'
const sha = 'a'.repeat(40)
const check = {
  id: 1,
  name: 'Check',
  path: '.github/workflows/check.yml',
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
}
const release = {
  ...check,
  id: 2,
  name: 'Package release',
  path: '.github/workflows/release-desktop.yml',
  display_title: 'Package release',
  event: 'workflow_dispatch',
}
void test('publishes only after exact-source Check and Release both pass in either completion order', () => {
  assert.equal(publicationPair([check], sha), null)
  assert.equal(publicationPair([release], sha), null)
  assert.equal(publicationPair([release, check], sha), release)
  assert.equal(publicationPair([check, release], sha), release)
  const tagged = { ...release, head_branch: 'v0.0.9-nightly.526', event: 'push' }
  assert.equal(publicationPair([check, tagged], sha), tagged)
  assert.equal(publicationPair([check, { ...release, head_branch: 'feature' }], sha), null)
  for (const change of [
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { head_sha: 'b'.repeat(40) },
    { event: 'pull_request' },
  ])
    assert.equal(publicationPair([{ ...check, ...change }, release], sha), null)
  assert.equal(
    publicationPair([check, release, { ...check, id: 3, status: 'in_progress' }], sha),
    null,
  )
})
void test('verify-only runs cannot supersede a ready nightly but a pending package run can', () => {
  const verifyOnly = {
    ...release,
    id: 3,
    status: 'in_progress',
    display_title: 'Verify release assets',
  }
  assert.equal(publicationPair([check, release, verifyOnly], sha), release)
  assert.equal(
    publicationPair([check, release, { ...verifyOnly, display_title: 'Release' }], sha),
    null,
  )
})

void test('rejects mismatched or non-nightly release provenance', () => {
  const manifest = { sha, channel: 'nightly', tag: 'v0.0.9-nightly.526' }
  const release = { tagName: manifest.tag, targetCommitish: sha, isPrerelease: true }
  validatePublication(manifest, sha, release)
  for (const change of [{ sha: 'b'.repeat(40) }, { channel: 'stable' }, { tag: 'v0.0.9' }])
    assert.throws(() => validatePublication({ ...manifest, ...change }, sha, release))
  assert.throws(() => validatePublication(manifest, sha, { ...release, targetCommitish: 'main' }))
})

void test('desktop publication dispatches distribution once and never starts a mobile release', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-publication-test-'))
  const tag = 'v0.0.9-nightly.526'
  const assets = Object.fromEntries(
    releaseFiles(tag).required.map((name) => [name, `sha256:${'a'.repeat(64)}`]),
  )
  const fixture = {
    runs: [check, release, { ...release, id: 3 }],
    manifest: { sha, channel: 'nightly', tag },
    buildManifest: { version: 1, sha, tag, assets },
    releaseAssets: [
      ...Object.entries(assets).map(([name, digest]) => ({ name, digest })),
      { name: manifestName },
    ],
    release: {
      databaseId: 7,
      tagName: tag,
      targetCommitish: sha,
      isPrerelease: true,
      isDraft: true,
    },
    releases: [
      { draft: true, tag_name: 'v0.0.9-nightly.527', body: 'x'.repeat(2 * 1024 * 1024) },
      { draft: false, tag_name: 'v0.0.9-nightly.525' },
    ],
  }
  try {
    writeFileSync(join(directory, 'fixture.json'), JSON.stringify(fixture))
    writeFileSync(join(directory, 'git'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    writeFileSync(
      join(directory, 'gh'),
      `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const root = process.env.PUBLICATION_FIXTURE;
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json')));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(args)+'\\n');
if (args[0] === 'api' && args[1].includes('/3/artifacts')) console.log(JSON.stringify({artifacts:[]}));
else if (args[0] === 'api' && args[1].includes('/3/jobs')) console.log(JSON.stringify({jobs:[{name:'draft',conclusion:'skipped'},{name:'verify',conclusion:'success'}]}));
else if (args[0] === 'api' && args[1].includes('/artifacts')) console.log(JSON.stringify({artifacts:[{name:'nightly-publication',expired:false}]}));
else if (args[0] === 'api' && args[1].includes('/actions/runs?')) console.log(JSON.stringify({workflow_runs:fixture.runs}));
else if (args[0] === 'api' && args[1].endsWith('/releases/7')) console.log(JSON.stringify(fixture.releaseAssets));
else if (args[0] === 'api') {
  // Model gh's output projection. Without it, this realistic release history
  // exceeds the publication subprocess's default buffer and the test fails.
  const releases = args.at(-2) === '--jq' && args.at(-1) === 'map({draft, tag_name})'
    ? fixture.releases.map(({draft, tag_name}) => ({draft, tag_name})) : fixture.releases;
  console.log(JSON.stringify(releases));
}
else if (args[0] === 'run') fs.writeFileSync(path.join(args.at(-1),'nightly.json'),JSON.stringify(fixture.manifest));
else if (args[0] === 'release' && args[1] === 'download') fs.writeFileSync(path.join(args.at(-1),${JSON.stringify(manifestName)}),JSON.stringify(fixture.buildManifest));
else if (args[0] === 'release' && args[1] === 'view') console.log(JSON.stringify(fixture.release));
else if (args[0] === 'release' && args[1] === 'edit') {fixture.release.isDraft=false;fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify(fixture));}
`,
      { mode: 0o700 },
    )
    const run = () =>
      execFileSync(process.execPath, ['scripts/ci/publish-nightly.mjs'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: directory + delimiter + process.env.PATH,
          PUBLICATION_FIXTURE: directory,
          GH_REPO: 'fixture/studio',
          SOURCE_SHA: sha,
        },
      })
    const oldTag = 'v0.0.9-nightly.525'
    writeFileSync(
      join(directory, 'fixture.json'),
      JSON.stringify({
        ...fixture,
        manifest: { ...fixture.manifest, tag: oldTag },
        release: { ...fixture.release, tagName: oldTag },
        releaseAssets: fixture.releaseAssets.filter(({ name }) => name !== manifestName),
      }),
    )
    assert.throws(run, /rebuild a draft with the current Release workflow/)
    const blocked = readFileSync(join(directory, 'calls.jsonl'), 'utf8')
    assert.doesNotMatch(blocked, /"edit"|"workflow"/)

    writeFileSync(join(directory, 'fixture.json'), JSON.stringify(fixture))
    writeFileSync(join(directory, 'calls.jsonl'), '')
    run()
    run()
    const calls = readFileSync(join(directory, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(calls.filter((args) => args[0] === 'release' && args[1] === 'edit').length, 1)
    assert.deepEqual(
      calls.filter((args) => args[0] === 'workflow'),
      [['workflow', 'run', 'distribution.yml', '-f', `tag=${tag}`]],
    )

    // A newer published nightly must still prevent an older draft from publishing.
    const newer = JSON.parse(readFileSync(join(directory, 'fixture.json'), 'utf8'))
    newer.release.isDraft = true
    newer.releases[0].draft = false
    writeFileSync(join(directory, 'fixture.json'), JSON.stringify(newer))
    writeFileSync(join(directory, 'calls.jsonl'), '')
    run()
    const skippedCalls = readFileSync(join(directory, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(
      skippedCalls.some((args) => args[0] === 'workflow'),
      false,
    )
    assert.equal(
      skippedCalls.some((args) => args[0] === 'release' && args[1] === 'edit'),
      false,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
