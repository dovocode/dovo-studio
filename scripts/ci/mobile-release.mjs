import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const github = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()

export function requireMobileChecks(sha, gh = github) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid mobile source commit')
  for (const workflow of ['check.yml', 'check-mobile.yml']) {
    const [run] = JSON.parse(
      gh(
        'run',
        'list',
        '--workflow',
        workflow,
        '--commit',
        sha,
        '--limit',
        '1',
        '--json',
        'status,conclusion,headSha',
      ),
    )
    if (run?.headSha !== sha || run.status !== 'completed' || run.conclusion !== 'success')
      throw new Error(`A successful ${workflow} run is required for this exact commit (${sha})`)
  }
}

export function mobileBuildNumber(base, run, attempt) {
  const values = [base, run, attempt].map(Number)
  if (!values.every(Number.isSafeInteger) || values.some((value) => value < 1) || values[2] > 99)
    throw new Error('Invalid mobile build sequence')
  const number = values[0] + values[1] * 100 + values[2]
  if (number > 2_100_000_000) throw new Error('Mobile build number exceeds the store limit')
  return String(number)
}
export function mobileReleaseTag(version, build) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error('Invalid mobile version')
  if (!/^[1-9][0-9]*$/.test(build) || Number(build) > 2_100_000_000)
    throw new Error('Invalid mobile build number')
  return `mobile-v${version}-beta.${build}`
}
export function mobileArtifactName(version, build, platform) {
  mobileReleaseTag(version, build)
  if (!['ios', 'android'].includes(platform)) throw new Error('Invalid mobile platform')
  return `Dovo-Studio-Mobile-${version}-beta.${build}-${platform}.${platform === 'ios' ? 'ipa' : 'aab'}`
}

export function publishMobileRelease({ version, build, sha, platform, directory }, gh = github) {
  const tag = mobileReleaseTag(version, build)
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid mobile source commit')
  if (!['all', 'ios', 'android'].includes(platform)) throw new Error('Invalid mobile platform')
  const platforms = platform === 'all' ? ['ios', 'android'] : [platform]
  const files = platforms.flatMap((platform) => {
    const file = join(directory, mobileArtifactName(version, build, platform))
    const provenance = JSON.parse(readFileSync(`${file}.json`, 'utf8'))
    if (
      provenance.version !== version ||
      provenance.build !== build ||
      provenance.platform !== platform ||
      provenance.commit !== sha ||
      provenance.releaseTag !== tag ||
      provenance.sha256 !== createHash('sha256').update(readFileSync(file)).digest('hex')
    )
      throw new Error(`Mobile artifact provenance does not match ${tag} (${platform})`)
    return [file, `${file}.json`]
  })
  const releases = JSON.parse(gh('release', 'list', '--limit', '100', '--json', 'tagName'))
  if (releases.some((release) => release.tagName === tag)) {
    const release = JSON.parse(
      gh('release', 'view', tag, '--json', 'targetCommitish,isPrerelease,isDraft'),
    )
    if (release.targetCommitish !== sha || release.isPrerelease !== true)
      throw new Error('Existing mobile release does not match this beta source')
    if (!release.isDraft) return tag
  } else {
    gh(
      'release',
      'create',
      tag,
      '--draft',
      '--prerelease',
      '--latest=false',
      '--target',
      sha,
      '--title',
      `Dovo Studio Mobile ${version} (Beta ${build})`,
      '--notes',
      `Mobile beta build ${build} from ${sha}.\n\nSigned mobile packages and SHA256 provenance. Store processing and tester availability are separate from this GitHub release.`,
    )
  }
  gh('release', 'upload', tag, ...files, '--clobber')
  gh('release', 'edit', tag, '--draft=false', '--prerelease', '--latest=false')
  return tag
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'check') {
  requireMobileChecks(process.env.GITHUB_SHA)
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {
    GITHUB_OUTPUT,
    MOBILE_BUILD_NUMBER_BASE = '2026101902',
    GITHUB_RUN_NUMBER,
    GITHUB_RUN_ATTEMPT,
  } = process.env
  const version = JSON.parse(readFileSync('apps/mobile/app.json', 'utf8')).expo.version
  if (process.argv[2] === 'publish') {
    const tag = publishMobileRelease({
      version,
      build: process.env.DOVO_MOBILE_BUILD_NUMBER,
      sha: process.env.GITHUB_SHA,
      platform: process.env.PLATFORM,
      directory: 'work/mobile-release',
    })
    console.log(`Published ${tag}`)
  } else {
    const build = mobileBuildNumber(MOBILE_BUILD_NUMBER_BASE, GITHUB_RUN_NUMBER, GITHUB_RUN_ATTEMPT)
    if (!GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
    appendFileSync(GITHUB_OUTPUT, `build=${build}\ntag=${mobileReleaseTag(version, build)}\n`)
  }
}
