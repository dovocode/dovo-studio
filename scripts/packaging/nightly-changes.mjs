import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function nightlyChanges({ target, releases, cwd }) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  const commit = git('rev-parse', '--verify', `${target}^{commit}`)
  for (const release of releases) {
    if (release.isDraft || !/^v\d+\.\d+\.\d+(?:-nightly\.\d+)?$/.test(release.tagName)) continue
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', release.tagName, commit], {
      cwd,
    })
    if (ancestor.error) throw ancestor.error
    if (ancestor.status === 1) continue
    if (ancestor.status !== 0) throw new Error(`Cannot resolve release ${release.tagName}`)
    // Distribution commits are produced by publication and must not produce another nightly.
    const changes = git(
      'log',
      '--format=%H',
      `${release.tagName}..${commit}`,
      '--',
      '.',
      ':(exclude)Casks',
      ':(exclude)Formula',
    )
    return { build: changes.length > 0, previous: release.tagName }
  }
  return { build: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2]
  if (!target) throw new Error('Usage: nightly-changes.mjs <commit>')
  const releases = JSON.parse(
    execFileSync(
      'gh',
      [
        'release',
        'list',
        '--exclude-drafts',
        '--limit',
        '100',
        '--json',
        'tagName,isDraft,publishedAt',
      ],
      { encoding: 'utf8' },
    ),
  )
  releases.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  const result = nightlyChanges({ target, releases })
  console.error(
    result.previous
      ? `Changes since ${result.previous}: ${result.build}`
      : 'No published ancestor; building first nightly.',
  )
  process.stdout.write(String(result.build))
}
