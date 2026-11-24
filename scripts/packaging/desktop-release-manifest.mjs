import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const manifestName = 'dovo-release-manifest.json'
const commit = /^[a-f0-9]{40}$/
const sha256 = /^sha256:[a-f0-9]{64}$/
const tagPattern = /^v\d+\.\d+\.\d+(?:-nightly\.\d+)?$/
const filename = /^[\w.-]+$/
const verifierPath = 'scripts/packaging/desktop-release-manifest.mjs'

export function releaseFiles(tag) {
  if (!tagPattern.test(tag)) throw new Error('Expected a Stable or Nightly desktop release tag')
  const version = tag.slice(1)
  const nightly = tag.includes('-nightly.')
  const studio = nightly ? 'Dovo-Studio-Nightly' : 'Dovo-Studio'
  const server = nightly ? 'Dovo-Server-Nightly' : 'Dovo-Server'
  const channel = nightly ? 'nightly' : 'latest'
  const macZip = `${studio}-${version}-arm64.zip`
  const macDmg = `${studio}-${version}-arm64.dmg`
  const windows = `${studio}-${version}-windows-x64.exe`
  const linux = `${studio}-${version}-linux-x86_64.AppImage`
  const arm = `${studio}-${version}-linux-arm64.AppImage`
  const feeds = {
    [`${channel}-mac.yml`]: [macZip, macDmg],
    [`${channel}.yml`]: [windows],
    [`${channel}-linux.yml`]: [linux],
    [`${channel}-linux-arm64.yml`]: [arm],
  }
  const distributionFiles = [
    macZip,
    `${studio}-mise-${version}-macos-arm64.tar.gz`,
    ...['macos-arm64', 'linux-x64', 'linux-arm64'].map(
      (platform) => `${server}-${version}-${platform}.tar.gz`,
    ),
  ]
  return {
    version,
    feeds,
    distributionFiles,
    studio,
    server,
    channel,
    required: [
      ...distributionFiles,
      macDmg,
      windows,
      linux,
      arm,
      `${server}-${version}-windows-x64.zip`,
      ...['amd64.deb', 'arm64.deb', 'x86_64.rpm', 'aarch64.rpm'].map(
        (format) => `${studio}-${version}-linux-${format}`,
      ),
      ...Object.keys(feeds),
    ],
  }
}

function tagCommit(tag, tags) {
  const refs = new Map(
    tags.split('\n').map((line) => {
      const [object, ref] = line.split(/\s+/)
      return [ref, object]
    }),
  )
  const ref = `refs/tags/${tag}`
  return refs.get(`${ref}^{}`) ?? refs.get(ref)
}

export function validateSource(tag, sha, tags, { allowMissing = false } = {}) {
  releaseFiles(tag)
  if (!commit.test(sha)) throw new Error('Expected a complete release source SHA')
  const tagged = tagCommit(tag, tags)
  if (!tagged && allowMissing && tag.includes('-nightly.')) return
  if (tagged !== sha)
    throw new Error(`Tag ${tag} points to ${tagged ?? 'no commit'}, expected ${sha}`)
}

export function validatePublished(manifest, tag, assets, tags, { sha, draft = false } = {}) {
  const { required } = releaseFiles(tag)
  if (manifest.version !== 1 || manifest.tag !== tag || (sha && manifest.sha !== sha))
    throw new Error('Release manifest does not match the expected tag and source')
  validateSource(tag, manifest.sha, tags, { allowMissing: draft })
  const recorded = new Map(Object.entries(manifest.assets))
  for (const name of required)
    if (!recorded.has(name)) throw new Error(`Missing release asset: ${name}`)
  const published = new Map(assets.map(({ name, digest }) => [name, digest]))
  for (const [name, digest] of recorded) {
    if (
      !filename.test(name) ||
      (!required.includes(name) && !name.endsWith('.blockmap')) ||
      !sha256.test(digest) ||
      published.get(name) !== digest
    )
      throw new Error(`Release asset digest did not match: ${name}`)
  }
  for (const name of published.keys())
    if (!recorded.has(name) && ![manifestName, 'SHA256SUMS', 'mise.toml'].includes(name))
      throw new Error(`Release asset is missing from the build manifest: ${name}`)
  return manifest.sha
}

async function digest(path, algorithm, encoding) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest(encoding)
}

async function validateFeeds(version, feeds, assetPath) {
  const require = createRequire(new URL('../../packages/runtime/package.json', import.meta.url))
  const { parse } = require('yaml')
  for (const [name, allowed] of feeds) {
    const feed = parse(await readFile(assetPath(name), 'utf8'))
    const files = feed?.files
    if (
      feed?.version !== version ||
      !Array.isArray(files) ||
      !files.some((entry) => entry?.url === allowed[0]) ||
      !files.some((entry) => entry?.url === feed.path && entry.sha512 === feed.sha512)
    )
      throw new Error(`Update feed did not match this release: ${name}`)
    for (const entry of files)
      if (
        !allowed.includes(entry?.url) ||
        entry.sha512 !== (await digest(assetPath(entry.url), 'sha512', 'base64'))
      )
        throw new Error(`Update feed asset or SHA-512 did not match: ${name}`)
  }
}

export async function buildManifest(directory, tag, sha) {
  const { version, feeds, required } = releaseFiles(tag)
  if (!commit.test(sha)) throw new Error('Expected a complete release source SHA')
  const names = (await readdir(directory)).filter((name) => name !== manifestName).sort()
  for (const name of required)
    if (!names.includes(name)) throw new Error(`Missing release asset: ${name}`)
  await validateFeeds(version, Object.entries(feeds), (name) => join(directory, name))
  const assets = {}
  for (const name of names) {
    if (!required.includes(name) && !name.endsWith('.blockmap'))
      throw new Error(`Unexpected release asset: ${name}`)
    assets[name] = `sha256:${await digest(join(directory, name), 'sha256', 'hex')}`
  }
  return { version: 1, tag, sha, assets }
}

const run = (command, ...args) => execFileSync(command, args, { encoding: 'utf8' }).trim()
const tagRefs = (tag) =>
  run('git', 'ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)

function historicalReleaseFiles(tag, sha, layout) {
  const workflow = run('git', 'show', `${sha}:.github/workflows/release-desktop.yml`)
  // Read only the former verifier's declarative asset list. Never execute tagged workflow code.
  const patterns = workflow.match(/for pattern in \\\r?\n([\s\S]*?); do/)
  if (!patterns) throw new Error(`Cannot read the historical release asset list for ${tag}`)
  const required = patterns[1].split('\n').map((line) =>
    line
      .trim()
      .replace(/\s*\\$/, '')
      .replace(/^"(.*)"$/, '$1')
      .replaceAll('${TAG#v}', layout.version)
      .replaceAll('$PREFIX', layout.studio)
      .replaceAll('$SERVER', layout.server)
      .replaceAll('$FEED', layout.channel),
  )
  if (required.some((name) => !filename.test(name)))
    throw new Error(`Could not interpret the historical release asset list for ${tag}`)
  return required
}

async function verifyLegacy(tag, assets, tags, directory, localDirectory, publishedOnly) {
  const sha = tagCommit(tag, tags)
  if (!sha || !commit.test(sha))
    throw new Error(`Published release tag ${tag} must point to a commit`)
  run('git', 'fetch', '--quiet', '--no-tags', '--depth=1', 'origin', `refs/tags/${tag}`)
  if (run('git', 'rev-parse', 'FETCH_HEAD^{commit}') !== sha)
    throw new Error(`Tag ${tag} moved while its source was being checked`)
  if (run('git', 'ls-tree', sha, '--', verifierPath))
    throw new Error(`Missing ${manifestName} for ${tag}; its source requires a build manifest`)

  const layout = releaseFiles(tag)
  const { version, feeds, studio, channel, distributionFiles } = layout
  const published = new Map(assets.map(({ name, digest }) => [name, digest]))
  const expected = publishedOnly ? distributionFiles : historicalReleaseFiles(tag, sha, layout)
  for (const name of expected)
    if (!published.has(name)) throw new Error(`Missing release asset: ${name}`)

  const availableFeeds = Object.entries({
    ...feeds,
    [`${channel}-arm64.yml`]: [`${studio}-${version}-windows-arm64.exe`],
  }).filter(([name]) => published.has(name))
  const localFiles = localDirectory ? await readdir(localDirectory) : []
  const assetPath = (name) => join(localFiles.includes(name) ? localDirectory : directory, name)
  const names = new Set(expected)
  for (const [feed, installers] of availableFeeds) {
    names.add(feed)
    for (const installer of installers) if (published.has(installer)) names.add(installer)
  }
  for (const name of localFiles) if (filename.test(name) && published.has(name)) names.add(name)
  const missing = [...names].filter((name) => !localFiles.includes(name))
  if (missing.length)
    run(
      'gh',
      'release',
      'download',
      tag,
      '--dir',
      directory,
      ...missing.flatMap((name) => ['--pattern', name]),
    )
  await validateFeeds(version, availableFeeds, assetPath)
  let withoutDigest = 0
  for (const name of names) {
    const expectedDigest = published.get(name)
    const actual = `sha256:${await digest(assetPath(name), 'sha256', 'hex')}`
    if (!expectedDigest) withoutDigest++
    else if (expectedDigest !== actual)
      throw new Error(`Downloaded release asset digest did not match: ${name}`)
  }
  console.error(
    `Legacy release ${tag}: verified the source tag, published asset inventory and available update feeds and digests. No build manifest binds these assets to the source. ${withoutDigest} checked assets lacked a published SHA-256 digest.`,
  )
  return sha
}

export async function verify(tag, { draftSha, publishedOnly, localDirectory }) {
  releaseFiles(tag)
  const details = JSON.parse(
    run('gh', 'release', 'view', tag, '--json', 'databaseId,targetCommitish,isDraft,publishedAt'),
  )
  if (!Number.isSafeInteger(details.databaseId) || typeof details.isDraft !== 'boolean')
    throw new Error('GitHub returned incomplete release metadata')
  if (publishedOnly && details.isDraft) throw new Error('Release is still a draft')
  const assets = JSON.parse(
    run(
      'gh',
      'api',
      `repos/${process.env.GH_REPO}/releases/${details.databaseId}`,
      '--jq',
      '.assets | map({name, digest})',
    ),
  )
  const tags = tagRefs(tag)
  const directory = await mkdtemp(join(tmpdir(), 'dovo-release-verification-'))
  try {
    if (!assets.some(({ name }) => name === manifestName)) {
      if (details.isDraft || draftSha)
        throw new Error(
          `Missing ${manifestName} for ${tag}; rebuild a draft with the current Release workflow`,
        )
      if (
        typeof details.publishedAt !== 'string' ||
        !Number.isFinite(Date.parse(details.publishedAt))
      )
        throw new Error(`GitHub has no publication date for ${tag}`)
      return await verifyLegacy(tag, assets, tags, directory, localDirectory, publishedOnly)
    }
    run('gh', 'release', 'download', tag, '--pattern', manifestName, '--dir', directory)
    const manifestContents = await readFile(join(directory, manifestName), 'utf8')
    if (
      draftSha &&
      localDirectory &&
      (await readFile(join(localDirectory, manifestName), 'utf8')) !== manifestContents
    )
      throw new Error('Published manifest bytes differ from the completed build')
    const manifest = JSON.parse(manifestContents)
    if (details.isDraft && tag.includes('-nightly.') && details.targetCommitish !== manifest.sha)
      throw new Error('Nightly draft target does not match the release manifest')
    const sha = validatePublished(manifest, tag, assets, tags, {
      sha: draftSha,
      draft: details.isDraft,
    })
    if (publishedOnly && localDirectory)
      for (const name of await readdir(localDirectory))
        if (
          Object.hasOwn(manifest.assets, name) &&
          manifest.assets[name] !==
            `sha256:${await digest(join(localDirectory, name), 'sha256', 'hex')}`
        )
          throw new Error(`Downloaded release asset digest did not match: ${name}`)
    return sha
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, tag, expected, directory] = process.argv.slice(2)
  if (action === 'source') {
    releaseFiles(tag)
    validateSource(tag, expected, tagRefs(tag), { allowMissing: true })
  } else if (action === 'build') {
    const manifest = await buildManifest(directory, tag, expected)
    await writeFile(join(directory, manifestName), JSON.stringify(manifest, null, 2) + '\n')
  } else if (action === 'verify' || action === 'published') {
    console.log(
      await verify(tag, {
        draftSha: expected,
        publishedOnly: action === 'published',
        localDirectory: directory,
      }),
    )
  } else {
    throw new Error(
      'Usage: desktop-release-manifest.mjs source|build|verify|published TAG [SHA] [DIRECTORY]',
    )
  }
}
