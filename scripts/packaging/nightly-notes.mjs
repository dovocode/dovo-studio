import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function nightlyNotes({ target, releases, repository, cwd }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid release repository')
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const commit = git('rev-parse', '--verify', `${target}^{commit}`)
  // Published releases only: a failed build's draft is not an update users received.
  const previous = releases.find((release) => {
    if (release.isDraft || !/^v\d+\.\d+\.\d+-nightly\.\d+$/.test(release.tagName)) return false
    const result = spawnSync('git', ['merge-base', '--is-ancestor', release.tagName, commit], {
      cwd,
    })
    if (result.error) throw result.error
    if (result.status !== 0 && result.status !== 1)
      throw new Error(`Cannot resolve release ${release.tagName}`)
    return result.status === 0
  })
  const range = previous ? `${previous.tagName}..${commit}` : commit
  const lines = git('log', '--reverse', '--format=%H %s', range).split('\n').filter(Boolean)
  const changes = lines.map((line) => {
    const sha = line.slice(0, 40)
    const subject = line.slice(41).replace(/[\\`*_{}[\]<>]/g, '\\$&')
    return `- ${subject} ([${sha.slice(0, 7)}](https://github.com/${repository}/commit/${sha}))`
  })
  return [
    '## Changes',
    '',
    ...(changes.length ? changes : ['No new commits since the previous nightly.']),
    ...(previous
      ? [
          '',
          `[Full comparison](https://github.com/${repository}/compare/${previous.tagName}...${commit})`,
        ]
      : []),
    '',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2]
  if (!target) throw new Error('Usage: nightly-notes.mjs <commit>')
  const repository = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY
  if (!repository) throw new Error('GH_REPO or GITHUB_REPOSITORY is required')
  const releases = JSON.parse(
    execFileSync(
      'gh',
      ['release', 'list', '--exclude-drafts', '--limit', '100', '--json', 'tagName,isDraft'],
      { encoding: 'utf8' },
    ),
  )
  process.stdout.write(nightlyNotes({ target, releases, repository }))
}
