import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
// Exercises the release workflow's verification shell as written, so channel detection and
// asset naming are tested against complete generated asset lists without dispatching a run.
const workflow = await readFile(
  new URL('../../.github/workflows/release-desktop.yml', import.meta.url),
  'utf8',
)
function verifyScript() {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => line.includes('name: Verify release assets'))
  assert.ok(start >= 0, 'verify step present')
  const run = lines.findIndex((line, index) => index > start && line.trim() === 'run: |')
  const indent = lines[run + 1].match(/^ */)[0].length
  const body = []
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && line.match(/^ */)[0].length < indent) break
    body.push(line.slice(indent))
  }
  return body.join('\n')
}
export function releaseAssets(tag) {
  const version = tag.replace(/^v/, '')
  const nightly = version.includes('-nightly.')
  const prefix = nightly ? 'Dovo-Studio-Nightly' : 'Dovo-Studio'
  const server = nightly ? 'Dovo-Server-Nightly' : 'Dovo-Server'
  const feed = nightly ? 'nightly' : 'latest'
  return [
    `${prefix}-${version}-arm64.dmg`,
    `${prefix}-${version}-arm64.zip`,
    `${prefix}-mise-${version}-macos-arm64.tar.gz`,
    `${server}-${version}-macos-arm64.tar.gz`,
    `${server}-${version}-linux-x64.tar.gz`,
    `${server}-${version}-linux-arm64.tar.gz`,
    `${server}-${version}-windows-x64.zip`,
    `${server}-${version}-windows-arm64.zip`,
    `${prefix}-${version}-windows-x64.exe`,
    `${prefix}-${version}-windows-arm64.exe`,
    `${prefix}-${version}-linux-amd64.deb`,
    `${prefix}-${version}-linux-arm64.deb`,
    `${prefix}-${version}-linux-x86_64.rpm`,
    `${prefix}-${version}-linux-aarch64.rpm`,
    `${prefix}-${version}-linux-x86_64.AppImage`,
    `${prefix}-${version}-linux-arm64.AppImage`,
    `${feed}.yml`,
    `${feed}-arm64.yml`,
    `${feed}-linux.yml`,
    `${feed}-linux-arm64.yml`,
    `${feed}-mac.yml`,
  ]
}
async function verify(directory, { tag, channel, assets }) {
  await writeFile(join(directory, 'assets'), assets.join('\n') + '\n')
  const gh = join(directory, 'gh')
  await writeFile(gh, `#!/bin/sh\ncat "${join(directory, 'assets')}"\n`)
  await chmod(gh, 0o755)
  const summary = join(directory, 'summary')
  await writeFile(summary, '')
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', verifyScript()], {
    env: {
      PATH: `${directory}:${process.env.PATH}`,
      HOME: directory,
      TAG: tag,
      CHANNEL: channel,
      GITHUB_STEP_SUMMARY: summary,
    },
    encoding: 'utf8',
  })
  return { status: result.status, output: result.stdout + result.stderr }
}
await test('verify-only dispatch derives the channel from the tag and checks the matching asset names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-release-verify-'))
  try {
    const stable = 'v1.2.3',
      nightly = 'v1.2.3-nightly.7'
    for (const [tag, channel] of [
      [stable, ''],
      [stable, 'stable'],
      [nightly, ''],
      [nightly, 'nightly'],
    ]) {
      const ok = await verify(directory, { tag, channel, assets: releaseAssets(tag) })
      assert.equal(ok.status, 0, `${tag} with channel "${channel}": ${ok.output}`)
    }
    const wrongNames = await verify(directory, {
      tag: nightly,
      channel: '',
      assets: releaseAssets(stable),
    })
    assert.notEqual(wrongNames.status, 0)
    assert.match(
      wrongNames.output,
      /Missing release asset: Dovo-Studio-Nightly-1\.2\.3-nightly\.7-arm64\.dmg/,
    )
    const stableAgainstNightly = await verify(directory, {
      tag: stable,
      channel: '',
      assets: releaseAssets(nightly),
    })
    assert.notEqual(stableAgainstNightly.status, 0)
    assert.match(
      stableAgainstNightly.output,
      /Missing release asset: Dovo-Studio-1\.2\.3-arm64\.dmg/,
    )
    const incomplete = await verify(directory, {
      tag: nightly,
      channel: 'nightly',
      assets: releaseAssets(nightly).filter((name) => name !== 'nightly-mac.yml'),
    })
    assert.notEqual(incomplete.status, 0)
    assert.match(incomplete.output, /Missing release asset: nightly-mac\.yml/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
