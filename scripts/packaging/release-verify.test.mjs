import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  buildManifest,
  manifestName,
  releaseFiles,
  validatePublished,
} from './desktop-release-manifest.mjs'

// Run the release steps against disposable Git refs and release metadata.
const workflow = await readFile(
  new URL('../../.github/workflows/release-desktop.yml', import.meta.url),
  'utf8',
)
const { parse } = createRequire(new URL('../../packages/runtime/package.json', import.meta.url))(
  'yaml',
)

void test('Windows release artifacts come from x64 builds and upload waits for signing', async () => {
  const release = parse(workflow).jobs
  const check = parse(
    await readFile(new URL('../../.github/workflows/check.yml', import.meta.url), 'utf8'),
  ).jobs.windows
  assert.equal(check['runs-on'], 'windows-2025')
  assert.equal(check.if, undefined, 'Windows checks run on pushes and pull requests')
  assert.deepEqual(
    release.platform.strategy.matrix.include.filter((entry) => entry.runner.startsWith('windows')),
    [{ runner: 'windows-2025', arch: 'x64', unpacked: 'win-unpacked' }],
  )
  assert.deepEqual(release['windows-sign'].strategy.matrix.arch, ['x64'])
  assert.equal(release['windows-sign'].if, release.platform.if)
  assert.ok(release['windows-sign'].needs.includes('platform'))
  assert.ok(release.upload.needs.includes('windows-sign'), 'Signed artifacts must exist at upload')
})

const release = parse(workflow).jobs
const scriptPath = fileURLToPath(new URL('./desktop-release-manifest.mjs', import.meta.url))

function stepScript(job, name) {
  const step = release[job].steps.find((step) => step.name === name)
  assert.ok(step?.run, `${name} step present`)
  return step.run
}

async function fixture(action) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-release-verify-'))
  try {
    await action(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const sha = 'a'.repeat(40)
const tag = 'v1.2.3'
const tagged = (name = tag, source = sha) => `${source}\trefs/tags/${name}\n`

await test('manual stable draft rejects an annotated tag from another commit before GitHub mutation', async () => {
  await fixture(async (directory) => {
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
    await mkdir(join(directory, 'scripts/packaging'), { recursive: true })
    await mkdir(join(directory, 'scripts/changelog'), { recursive: true })
    await copyFile(scriptPath, join(directory, 'scripts/packaging/desktop-release-manifest.mjs'))
    await writeFile(join(directory, 'scripts/changelog/assemble-fragments.mjs'), '')
    await mkdir(join(directory, 'changelog.d'))
    await writeFile(join(directory, 'package.json'), '{"version":"1.2.3"}')
    git('init', '--quiet')
    git('config', 'user.email', 'fixture@example.test')
    git('config', 'user.name', 'Release fixture')
    git('add', 'package.json')
    git('commit', '--quiet', '-m', 'Tagged commit')
    git('tag', '-a', tag, '-m', 'Stable fixture')
    git('remote', 'add', 'origin', directory)
    const source = git('rev-parse', 'HEAD')
    git('commit', '--quiet', '--allow-empty', '-m', 'Different source')
    const other = git('rev-parse', 'HEAD')
    await writeFile(
      join(directory, 'gh'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_CALLS"\n[ "$2" != view ]\n',
    )
    await chmod(join(directory, 'gh'), 0o755)
    const calls = join(directory, 'calls')
    const output = join(directory, 'output')
    const runDraft = (source) =>
      spawnSync('bash', ['-euo', 'pipefail', '-c', stepScript('draft', 'Create release draft')], {
        cwd: directory,
        env: {
          PATH: `${directory}:${process.env.PATH}`,
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          GITHUB_SHA: source,
          INPUT_TAG: tag,
          GH_CALLS: calls,
          RUNNER_TEMP: directory,
          GITHUB_OUTPUT: output,
        },
        encoding: 'utf8',
      })
    const rejected = runDraft(other)
    assert.notEqual(rejected.status, 0)
    await assert.rejects(readFile(calls), { code: 'ENOENT' })
    await assert.rejects(readFile(output), { code: 'ENOENT' })
    assert.match(rejected.stderr, /points to .* expected/)
    git('checkout', '--quiet', source)
    const accepted = runDraft(git('rev-parse', tag))
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.match(
      await readFile(calls, 'utf8'),
      new RegExp(`release create ${tag} .* --target ${source}`),
    )
    assert.match(await readFile(output, 'utf8'), new RegExp(`sha=${source}`))
  })
})

await test('build manifest validates platform update feed hashes before upload and includes every binary', async () => {
  await fixture(async (directory) => {
    const { required, feeds } = releaseFiles(tag)
    for (const name of required) await writeFile(join(directory, name), name)
    for (const [name, [asset]] of Object.entries(feeds)) {
      const sha512 = createHash('sha512').update(asset).digest('base64')
      await writeFile(
        join(directory, name),
        JSON.stringify({
          version: tag.slice(1),
          files: [{ url: asset, sha512 }],
          path: asset,
          sha512,
        }),
      )
    }
    const manifest = await buildManifest(directory, tag, sha)
    assert.deepEqual(Object.keys(manifest.assets).sort(), [...required].sort())
    const assets = Object.entries(manifest.assets).map(([name, digest]) => ({ name, digest }))
    assert.equal(validatePublished(manifest, tag, assets, tagged()), sha)
    const binary = assets.find(({ name }) => name.endsWith('.exe'))
    assert.ok(binary)
    binary.digest = `sha256:${'b'.repeat(64)}`
    assert.throws(
      () => validatePublished(manifest, tag, assets, tagged()),
      /asset digest did not match/,
    )
    await writeFile(join(directory, binary.name), 'changed bytes')
    await assert.rejects(
      buildManifest(directory, tag, sha),
      /Update feed asset or SHA-512 did not match/,
    )
  })
})

for (const releaseTag of [tag, 'v1.2.3-nightly.42']) {
  await test(`build manifest verifies AppImage, DEB and RPM entries in each Linux feed for ${releaseTag}`, async () => {
    await fixture(async (directory) => {
      const { channel, feeds, required, studio, version } = releaseFiles(releaseTag)
      for (const name of required) await writeFile(join(directory, name), name)
      const writeFeed = (name, assets) => {
        const files = assets.map((url) => ({
          url,
          sha512: createHash('sha512').update(url).digest('base64'),
        }))
        return writeFile(
          join(directory, name),
          JSON.stringify({ version, files, path: files[0].url, sha512: files[0].sha512 }),
        )
      }
      for (const [name, [asset]] of Object.entries(feeds)) await writeFeed(name, [asset])

      const prefix = `${studio}-${version}-linux`
      const x64 = [`${prefix}-x86_64.AppImage`, `${prefix}-amd64.deb`, `${prefix}-x86_64.rpm`]
      const arm64 = [`${prefix}-arm64.AppImage`, `${prefix}-arm64.deb`, `${prefix}-aarch64.rpm`]
      const x64Feed = `${channel}-linux.yml`
      const arm64Feed = `${channel}-linux-arm64.yml`
      await writeFeed(x64Feed, x64)
      await writeFeed(arm64Feed, arm64)
      assert.equal((await buildManifest(directory, releaseTag, sha)).sha, sha)

      await writeFeed(x64Feed, [...x64, arm64[1]])
      await assert.rejects(
        buildManifest(directory, releaseTag, sha),
        /Update feed asset or SHA-512 did not match: (latest|nightly)-linux\.yml/,
      )

      await writeFeed(x64Feed, x64)
      await writeFile(join(directory, arm64[2]), 'changed ARM64 RPM bytes')
      await assert.rejects(
        buildManifest(directory, releaseTag, sha),
        /Update feed asset or SHA-512 did not match: (latest|nightly)-linux-arm64\.yml/,
      )
    })
  })
}

await test('verify-only runs the same digest verifier for existing stable and nightly releases', async () => {
  await fixture(async (directory) => {
    await writeFile(
      join(directory, 'gh'),
      `#!/bin/sh
case "$1 $2" in
  "release view") printf '%s\n' '{"databaseId":7,"isDraft":false}' ;;
  "release download") cp "$MANIFEST_FILE" "$7/dovo-release-manifest.json" ;;
  "api repos/fixture/dovo/releases/7") cat "$ASSET_FILE" ;;
  *) exit 1 ;;
esac
`,
    )
    await writeFile(join(directory, 'git'), '#!/bin/sh\nprintf "%s\\n" "$TAGS"\n')
    await mkdir(join(directory, 'scripts/packaging'), { recursive: true })
    await copyFile(scriptPath, join(directory, 'scripts/packaging/desktop-release-manifest.mjs'))
    for (const name of ['gh', 'git']) await chmod(join(directory, name), 0o755)
    const manifest = join(directory, 'manifest.json')
    const assetFile = join(directory, 'assets.json')
    const verify = (tag) =>
      spawnSync(
        'bash',
        ['-euo', 'pipefail', '-c', stepScript('verify', 'Verify release source and asset digests')],
        {
          cwd: directory,
          env: {
            PATH: `${directory}:${process.env.PATH}`,
            GH_REPO: 'fixture/dovo',
            TAG: tag,
            TAGS: tagged(tag),
            SOURCE_SHA: '',
            MANIFEST_FILE: manifest,
            ASSET_FILE: assetFile,
          },
          encoding: 'utf8',
        },
      )
    for (const releaseTag of [tag, `${tag}-nightly.7`]) {
      const assets = Object.fromEntries(
        releaseFiles(releaseTag).required.map((name) => [name, `sha256:${'a'.repeat(64)}`]),
      )
      await writeFile(manifest, JSON.stringify({ version: 1, tag: releaseTag, sha, assets }))
      const published = Object.entries(assets).map(([name, digest]) => ({ name, digest }))
      await writeFile(assetFile, JSON.stringify([...published, { name: manifestName }]))
      const matched = verify(releaseTag)
      assert.equal(matched.status, 0, matched.stderr)
      published[0].digest = `sha256:${'f'.repeat(64)}`
      await writeFile(assetFile, JSON.stringify([...published, { name: manifestName }]))
      const altered = verify(releaseTag)
      assert.notEqual(altered.status, 0)
      assert.match(altered.stderr, /asset digest did not match/)
    }
  })
})

await test('all release packages and signing use the verified source and Mac artifacts wait for signature verification', () => {
  for (const job of ['mac', 'platform', 'windows-sign', 'upload']) {
    const checkout = release[job].steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
    assert.equal(checkout.with.ref, '${{ needs.draft.outputs.sha }}')
  }
  const mac = release.mac.steps
  const build = stepScript('mac', 'Build signed Mac update artifacts')
  assert.match(build, /^\s*pnpm run package:platform\s*$/m)
  assert.doesNotMatch(build, /--publish/)
  const staged = mac.findIndex((step) => step.with?.name === 'desktop-macos-26')
  assert.ok(staged > mac.findIndex((step) => step.name === 'Verify Mac signature and notarization'))
  assert.match(mac[staged].with.path, /release\/\*-mac\.yml/)
  assert.match(
    stepScript('upload', 'Upload desktop and server packages into draft release'),
    /build .*release[\s\S]+gh release upload[\s\S]+verify/,
  )
})

await test('release jobs build the desktop app for the checked-out commit after restoring dependencies', () => {
  for (const job of ['mac', 'platform']) {
    const steps = release[job].steps
    const dependencies = steps.findIndex(({ run }) => run?.includes('@dovo/desktop^...'))
    const desktop = steps.findIndex(
      ({ run }) => run?.trim() === 'pnpm --filter @dovo/desktop build',
    )
    const prepare = steps.findIndex(({ run }) => run?.trim() === 'pnpm run package:prepare-runtime')
    assert.ok(
      dependencies >= 0 && desktop > dependencies && prepare > desktop,
      `${job} must build the desktop app outside the dependency cache before preparing packages`,
    )
  }
})

await test('legacy Stable tags use their historical Windows ARM64 checks and published feed digests', async () => {
  await fixture(async (directory) => {
    const tag = 'v0.0.8'
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
    const relativeVerifier = 'scripts/packaging/desktop-release-manifest.mjs'
    const checkoutWorkflow = join(directory, '.github/workflows')
    const assets = join(directory, 'asset-files')
    const stage = join(directory, 'stage')
    for (const folder of [checkoutWorkflow, assets, stage, join(directory, 'scripts/packaging')])
      await mkdir(folder, { recursive: true })
    const armExe = 'Dovo-Studio-0.0.8-windows-arm64.exe'
    const armServer = 'Dovo-Server-0.0.8-windows-arm64.zip'
    const { required, feeds } = releaseFiles(tag)
    const historical = [...required, armExe, armServer, 'latest-arm64.yml']
    await writeFile(
      join(checkoutWorkflow, 'release-desktop.yml'),
      [
        'for pattern in \\',
        historical.map((name) => `  "${name.replace('0.0.8', '${TAG#v}')}"`).join(' \\\n'),
        '; do',
      ]
        .join('\n')
        .replace('\n; do', '; do'),
    )
    git('init', '--quiet')
    git('config', 'user.email', 'fixture@example.test')
    git('config', 'user.name', 'Release fixture')
    git('add', '.github')
    git('commit', '--quiet', '-m', 'Legacy tag with historical release rules')
    git('tag', '-a', tag, '-m', 'Legacy Stable')
    git('remote', 'add', 'origin', directory)
    const legacySha = git('rev-parse', 'HEAD')
    const manifest = join(directory, 'published-assets.json')
    const response = join(directory, 'response.json')
    await writeFile(
      response,
      JSON.stringify({ databaseId: 8, isDraft: false, publishedAt: '2026-10-01T12:00:00Z' }),
    )
    for (const name of historical) await writeFile(join(assets, name), name)
    for (const [name, [asset]] of Object.entries({ ...feeds, 'latest-arm64.yml': [armExe] })) {
      const sha512 = createHash('sha512').update(asset).digest('base64')
      await writeFile(
        join(assets, name),
        JSON.stringify({
          version: '0.0.8',
          files: [{ url: asset, sha512 }],
          path: asset,
          sha512,
        }),
      )
    }
    const digests = await Promise.all(
      historical.map(async (name) => ({
        name,
        digest: `sha256:${createHash('sha256')
          .update(await readFile(join(assets, name)))
          .digest('hex')}`,
      })),
    )
    await writeFile(manifest, JSON.stringify(digests))
    for (const name of historical.filter((name) => /linux-.*\.tar\.gz$/.test(name)))
      await copyFile(join(assets, name), join(stage, name))
    await writeFile(
      join(directory, 'gh'),
      `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === 'api') process.stdout.write(fs.readFileSync(process.env.GH_ASSETS))
else if (args[1] === 'view') process.stdout.write(fs.readFileSync(process.env.GH_RESPONSE))
else if (args[1] === 'download') {
  const folder = args[args.indexOf('--dir') + 1]
  for (let i = 0; i < args.length; i++)
    if (args[i] === '--pattern') fs.copyFileSync(path.join(process.env.GH_FILES, args[i+1]), path.join(folder, args[i+1]))
}
else process.exit(1)
`,
      { mode: 0o700 },
    )
    const run = (...args) =>
      spawnSync(process.execPath, [scriptPath, ...args], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GH_REPO: 'fixture/dovo',
          GH_ASSETS: manifest,
          GH_RESPONSE: response,
          GH_FILES: assets,
        },
        encoding: 'utf8',
      })
    const checked = run('verify', tag)
    assert.equal(checked.status, 0, checked.stderr)
    assert.equal(checked.stdout.trim(), legacySha)
    assert.match(checked.stderr, /No build manifest binds these assets to the source/)
    await writeFile(response, JSON.stringify({ databaseId: 8, isDraft: false }))
    assert.match(run('verify', tag).stderr, /GitHub has no publication date/)
    await writeFile(
      response,
      JSON.stringify({ databaseId: 8, isDraft: false, publishedAt: '2026-10-01T12:00:00Z' }),
    )
    const distributed = run('published', tag, '', stage)
    assert.equal(distributed.status, 0, distributed.stderr)
    assert.equal(distributed.stdout.trim(), legacySha)
    await writeFile(
      manifest,
      JSON.stringify(
        digests.filter(
          ({ name }) => !name.includes('-windows-') && !/^latest(?:-arm64)?\.yml$/.test(name),
        ),
      ),
    )
    assert.equal(
      run('published', tag, '', stage).status,
      0,
      'Legacy distribution can backfill a release without Windows packages',
    )
    const linux = historical.find((name) => name.endsWith('-linux-x64.tar.gz'))
    await writeFile(join(stage, linux), 'altered Linux server archive')
    assert.match(
      run('published', tag, '', stage).stderr,
      /Downloaded release asset digest did not match/,
    )
    await copyFile(join(assets, linux), join(stage, linux))

    await writeFile(manifest, JSON.stringify(digests.filter(({ name }) => name !== armServer)))
    assert.match(
      run('verify', tag).stderr,
      /Missing release asset: Dovo-Server-0.0.8-windows-arm64.zip/,
    )
    await writeFile(manifest, JSON.stringify(digests))
    await writeFile(join(assets, armExe), 'altered ARM64 installer')
    assert.match(
      run('verify', tag).stderr,
      /Update feed asset or SHA-512 did not match: latest-arm64.yml/,
    )
    await writeFile(join(assets, armExe), armExe)

    await writeFile(
      response,
      JSON.stringify({ databaseId: 8, isDraft: true, targetCommitish: legacySha }),
    )
    assert.match(run('verify', tag).stderr, /rebuild a draft with the current Release workflow/)
    await writeFile(
      response,
      JSON.stringify({ databaseId: 8, isDraft: false, publishedAt: '2026-10-01T12:00:00Z' }),
    )
    await writeFile(manifest, JSON.stringify([...digests, { name: manifestName }]))
    await writeFile(join(assets, manifestName), '{}')
    assert.match(run('verify', tag).stderr, /Release manifest does not match/)
    await writeFile(manifest, JSON.stringify(digests))

    await copyFile(scriptPath, join(directory, relativeVerifier))
    git('add', relativeVerifier)
    git('commit', '--quiet', '-m', 'Source with release manifest support')
    git('tag', '-f', '-a', tag, '-m', 'Manifest-aware Stable')
    assert.match(run('verify', tag).stderr, /source requires a build manifest/)
    assert.match(run('published', tag, '', stage).stderr, /source requires a build manifest/)
  })
})
