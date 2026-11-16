import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  FRAGMENT_DIRECTORY,
  isFragmentName,
  parseFragment,
  renderNotes,
} from '../changelog/fragments.mjs'

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
  // Fragments added since the previous nightly are the curated user-facing summary.
  const fragmentPaths = (
    previous
      ? git(
          'diff',
          '--name-only',
          '--diff-filter=A',
          previous.tagName,
          commit,
          '--',
          FRAGMENT_DIRECTORY,
        )
      : git('ls-tree', '-r', '--name-only', commit, '--', FRAGMENT_DIRECTORY)
  )
    .split('\n')
    .filter((path) => {
      const [directory, name, ...nested] = path.split('/')
      return directory === FRAGMENT_DIRECTORY && !nested.length && isFragmentName(name ?? '')
    })
  const fragments = fragmentPaths.flatMap((path) => {
    const { fragment, errors } = parseFragment(path.split('/')[1], git('show', `${commit}:${path}`))
    if (errors) console.error(`Skipping invalid fragment ${path}: ${errors.join('; ')}`)
    return fragment ? [fragment] : []
  })
  const lines = git('log', '--reverse', '--format=%H %s', range).split('\n').filter(Boolean)
  const entries = lines.map((line) => {
    const sha = line.slice(0, 40)
    const title = line.slice(41)
    const subject = title.replace(/[\\`*_{}[\]<>]/g, '\\$&')
    return {
      title,
      line: `- ${subject} ([${sha.slice(0, 7)}](https://github.com/${repository}/commit/${sha}))`,
    }
  })
  // Keep the complete history below, but lead with recent user-facing changes rather
  // than distribution churn and fixture maintenance. No generated claims or API calls.
  const seen = new Set()
  const highlights = entries
    .toReversed()
    .filter(({ title }) => {
      const key = title.toLowerCase().replace(/\s*\(#\d+\)$/, '')
      if (
        seen.has(key) ||
        /^(?:merge\b|update homebrew distribution definitions\b|(?:chore|ci|test|build|docs)(?:\([^)]*\))?:)/i.test(
          title,
        ) ||
        /\b(?:fixtures?|smoke[- ]tests?|browser checks)\b/i.test(title)
      )
        return false
      seen.add(key)
      return true
    })
    .slice(0, 7)
    .map(({ line }) => line)
  return [
    ...(fragments.length
      ? ["## What's new", '', renderNotes(fragments)]
      : highlights.length
        ? ['## Highlights', '', ...highlights, '']
        : []),
    '## Changes',
    '',
    ...(entries.length
      ? entries.map(({ line }) => line)
      : ['No new commits since the previous nightly.']),
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
  // Publication can create a tag after checkout or the earlier changes check.
  // Refresh after reading releases so every published candidate can be resolved.
  execFileSync('git', ['fetch', 'origin', '--tags'], { stdio: 'inherit' })
  process.stdout.write(nightlyNotes({ target, releases, repository }))
}
