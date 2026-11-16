import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  FRAGMENT_DIRECTORY,
  formatProblems,
  insertRelease,
  readFragments,
  releaseSection,
  renderNotes,
} from './fragments.mjs'

const readOptional = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

function validFragments(cwd) {
  const { fragments, problems } = readFragments(join(cwd, FRAGMENT_DIRECTORY))
  if (problems.length)
    throw new Error(`Fix changelog fragments before release:\n\n${formatProblems(problems)}`)
  return fragments
}

/**
 * Moves every fragment into a new CHANGELOG.md section and deletes the fragment files.
 * Returns the consumed fragment names.
 */
export function assembleRelease({ cwd, version, date }) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`Release version "${version}" must look like 1.2.3`)
  const fragments = validFragments(cwd)
  if (!fragments.length) throw new Error(`No fragments in ${FRAGMENT_DIRECTORY}/ to release`)
  const changelogPath = join(cwd, 'CHANGELOG.md')
  const changelog = insertRelease(readOptional(changelogPath), {
    version,
    date,
    notes: renderNotes(fragments),
  })
  writeFileSync(changelogPath, changelog)
  for (const { name } of fragments) rmSync(join(cwd, FRAGMENT_DIRECTORY, name))
  return fragments.map(({ name }) => name)
}

const USAGE = `Usage:
  assemble-fragments.mjs release [version] [--date YYYY-MM-DD]
      Add the fragments to CHANGELOG.md as a new section and delete them.
      The version defaults to the root package.json version.
  assemble-fragments.mjs preview
      Print the notes for the current fragments without changing files.
  assemble-fragments.mjs notes <version>
      Print the CHANGELOG.md section for a version. Prints nothing if there is none.`

function main(argv, cwd) {
  const [command, ...rest] = argv.filter((argument) => argument !== '--')
  if (command === 'preview') {
    process.stdout.write(renderNotes(validFragments(cwd)) || 'No changelog fragments.\n')
    return
  }
  if (command === 'notes' && rest[0]) {
    process.stdout.write(releaseSection(readOptional(join(cwd, 'CHANGELOG.md')), rest[0]))
    return
  }
  if (command === 'release') {
    const dateIndex = rest.indexOf('--date')
    const date = dateIndex === -1 ? new Date().toISOString().slice(0, 10) : rest[dateIndex + 1]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('--date must be YYYY-MM-DD')
    const positional =
      dateIndex === -1
        ? rest
        : rest.filter((_, index) => index < dateIndex || index > dateIndex + 1)
    const version =
      positional[0] ?? JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version
    const names = assembleRelease({ cwd, version, date })
    console.log(
      `Added ${version} to CHANGELOG.md and removed ${names.length} fragment(s). ` +
        'Commit CHANGELOG.md and changelog.d/ with the version change.',
    )
    return
  }
  console.error(USAGE)
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2), process.cwd())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
