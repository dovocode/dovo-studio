import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  FRAGMENT_DIRECTORY,
  formatProblems,
  isFragmentName,
  needsFragment,
  readFragments,
} from './fragments.mjs'

/**
 * Decides if a change set needs a fragment. `changes` holds `{ status, path }` entries from
 * `git diff --name-status --no-renames`. Only an added fragment counts. A rename shows as a
 * deletion and an addition, so its new name counts too. An edit to an existing fragment does
 * not count, because that fragment already belongs to another change.
 */
export function fragmentRequirement(changes) {
  const fragmentPrefix = `${FRAGMENT_DIRECTORY}/`
  const hasFragment = changes.some(
    ({ status, path }) =>
      status === 'A' &&
      path.startsWith(fragmentPrefix) &&
      !path.slice(fragmentPrefix.length).includes('/') &&
      isFragmentName(path.slice(fragmentPrefix.length)),
  )
  const paths = changes.filter(({ path }) => needsFragment(path)).map(({ path }) => path)
  return { required: paths.length > 0, hasFragment, paths }
}

export function missingFragmentMessage(paths) {
  const shown = paths.slice(0, 10)
  return [
    'This pull request changes app or package code, but it adds no changelog fragment.',
    '',
    'Files that need a fragment:',
    ...shown.map((path) => `  ${path}`),
    ...(paths.length > shown.length ? [`  ... and ${paths.length - shown.length} more`] : []),
    '',
    'Add a file such as changelog.d/<pull request number>.md:',
    '',
    '  ---',
    '  category: Fixed',
    '  clients: desktop, mobile',
    '  ---',
    '  Thread titles stay the same after a reconnect.',
    '',
    'See changelog.d/README.md for the format.',
    'If users will not notice this change, add the skip-changelog label. The check then runs again.',
  ].join('\n')
}

function changedFiles(base, cwd) {
  const output = execFileSync('git', ['diff', '--name-status', '--no-renames', `${base}...HEAD`], {
    cwd,
    encoding: 'utf8',
  })
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split('\t')
      return { status: status[0], path }
    })
}

function main(argv, cwd) {
  const baseIndex = argv.indexOf('--base')
  const base = baseIndex === -1 ? undefined : argv[baseIndex + 1]
  if (baseIndex !== -1 && !base) throw new Error('Usage: check-fragments.mjs [--base <git ref>]')
  const { fragments, problems } = readFragments(join(cwd, FRAGMENT_DIRECTORY))
  if (problems.length) {
    console.error(`Changelog fragments have format errors:\n\n${formatProblems(problems)}`)
    console.error('\nSee changelog.d/README.md for the format.')
    return 1
  }
  console.log(`Changelog fragments: ${fragments.length} valid.`)
  if (!base) return 0
  const { required, hasFragment, paths } = fragmentRequirement(changedFiles(base, cwd))
  if (!required) console.log('No app or package code changed; a fragment is optional.')
  else if (hasFragment) console.log('This change adds a changelog fragment.')
  else {
    console.error(missingFragmentMessage(paths))
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2), process.cwd())
}
