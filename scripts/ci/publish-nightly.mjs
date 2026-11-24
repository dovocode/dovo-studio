import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify } from '../packaging/desktop-release-manifest.mjs'

// Both completion events run this once; either can arrive first. No waiting runner is needed.
export function publicationPair(runs, sha) {
  const latest = (path, release = false) =>
    runs
      .filter(
        (run) =>
          run.path?.split('@', 1)[0] === path &&
          (!release ||
            run.event !== 'workflow_dispatch' ||
            run.display_title !== 'Verify release assets') &&
          run.head_sha === sha &&
          (run.head_branch === 'main' ||
            (release && /^v\d+\.\d+\.\d+-nightly\.\d+$/.test(run.head_branch))) &&
          ['push', 'schedule', 'workflow_dispatch'].includes(run.event),
      )
      .sort((a, b) => b.id - a.id)[0]
  const check = latest('.github/workflows/check.yml'),
    release = latest('.github/workflows/release-desktop.yml', true)
  return check?.conclusion === 'success' &&
    check.status === 'completed' &&
    release?.conclusion === 'success' &&
    release.status === 'completed'
    ? release
    : null
}
export function validatePublication(manifest, sha, release) {
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    manifest.sha !== sha ||
    manifest.channel !== 'nightly' ||
    !/^v\d+\.\d+\.\d+-nightly\.\d+$/.test(manifest.tag) ||
    release.tagName !== manifest.tag ||
    release.targetCommitish !== sha ||
    !release.isPrerelease
  )
    throw new Error('Nightly provenance does not match the passing source commit')
}
async function publishNightly() {
  const sha = process.env.SOURCE_SHA
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('SOURCE_SHA is required')
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()
  const repo = process.env.GH_REPO
  let runs = JSON.parse(
    gh('api', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`),
  ).workflow_runs
  let candidate = publicationPair(runs, sha)
  while (candidate) {
    const endpoint = `repos/${repo}/actions/runs/${candidate.id}`
    const { artifacts } = JSON.parse(gh('api', `${endpoint}/artifacts?per_page=100`))
    if (artifacts.some(({ name, expired }) => name === 'nightly-publication' && !expired)) break
    // Verify-only dispatches from before the run-name marker can still be in the run history.
    const { jobs } = JSON.parse(gh('api', `${endpoint}/jobs?per_page=100`))
    if (!jobs.some(({ name, conclusion }) => name === 'draft' && conclusion === 'skipped')) {
      console.log('This release run has no verified nightly to publish.')
      return
    }
    runs = runs.filter(({ id }) => id !== candidate.id)
    candidate = publicationPair(runs, sha)
  }
  if (!candidate) {
    console.log('Publication deferred until Check and Release both pass for this exact SHA.')
    return
  }
  const directory = mkdtempSync(join(tmpdir(), 'dovo-nightly-'))
  try {
    gh('run', 'download', String(candidate.id), '--name', 'nightly-publication', '--dir', directory)
    const manifest = JSON.parse(readFileSync(join(directory, 'nightly.json'), 'utf8'))
    const release = JSON.parse(
      gh('release', 'view', manifest.tag, '--json', 'tagName,targetCommitish,isPrerelease,isDraft'),
    )
    validatePublication(manifest, sha, release)
    // Both completion events can queue after both runs finish. Publication is serialized,
    // so the second event must not dispatch distribution again.
    if (!release.isDraft) {
      console.log(
        `${manifest.tag} is already published; downstream workflows are not dispatched again.`,
      )
      return
    }
    // Full release responses include every asset and exceed execFileSync's buffer as
    // release history grows. Project the two fields needed before gh writes stdout.
    const releases = JSON.parse(
      gh('api', `repos/${repo}/releases?per_page=100`, '--jq', 'map({draft, tag_name})'),
    )
    const number = (tag) => Number(/^v\d+\.\d+\.\d+-nightly\.(\d+)$/.exec(tag)?.[1] ?? -1)
    if (releases.some((r) => !r.draft && number(r.tag_name) > number(manifest.tag))) {
      console.log('A newer nightly has already been published; leaving this draft untouched.')
      return
    }
    await verify(manifest.tag, { draftSha: sha })
    gh('release', 'edit', manifest.tag, '--draft=false', '--prerelease', '--latest=false')
    gh('workflow', 'run', 'distribution.yml', '-f', `tag=${manifest.tag}`)
    console.log(`Published ${manifest.tag} from passing source ${sha}.`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await publishNightly()
