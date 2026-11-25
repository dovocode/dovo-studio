import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Shared rules for changelog.d fragments. The header is a fixed two-line block, not YAML,
// so a fragment parses the same way in CI, in nightly notes and at stable release time.
export const FRAGMENT_DIRECTORY = 'changelog.d'
export const CATEGORIES = ['Added', 'Changed', 'Fixed', 'Removed', 'Security']
export const CLIENTS = ['desktop', 'web', 'mobile', 'server']
const MAX_LINES = 3
const FILE_NAME = /^(?:\d+|[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

export const isFragmentName = (name) => name !== 'README.md' && name.endsWith('.md')

/** Parses one fragment. Returns `{ fragment }` or `{ errors }` with readable messages. */
export function parseFragment(name, text) {
  const errors = []
  if (!FILE_NAME.test(name))
    errors.push(
      'name the file after the pull request number or a short lowercase slug, such as 123.md or fix-thread-titles.md',
    )
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const close = lines.indexOf('---', 1)
  if (lines[0] !== '---' || close === -1) {
    errors.push('start the file with a header between two "---" lines')
    return { errors }
  }
  const header = new Map()
  for (const line of lines.slice(1, close)) {
    if (!line.trim()) continue
    const match = /^(\w+):\s*(.*)$/.exec(line)
    if (!match) errors.push(`header line "${line}" must use "key: value"`)
    else if (header.has(match[1])) errors.push(`header key "${match[1]}" appears twice`)
    else header.set(match[1], match[2].trim())
  }
  for (const key of header.keys())
    if (key !== 'category' && key !== 'clients')
      errors.push(`unknown header key "${key}"; use only category and clients`)
  const category = header.get('category')
  if (!category) errors.push(`set "category:" to one of ${CATEGORIES.join(', ')}`)
  else if (!CATEGORIES.includes(category))
    errors.push(`category "${category}" is not one of ${CATEGORIES.join(', ')}`)
  const clients = (header.get('clients') ?? '')
    .split(',')
    .map((client) => client.trim())
    .filter(Boolean)
  if (!clients.length) errors.push(`set "clients:" to one or more of ${CLIENTS.join(', ')}`)
  for (const client of clients)
    if (!CLIENTS.includes(client))
      errors.push(`client "${client}" is not one of ${CLIENTS.join(', ')}`)
  const body = lines
    .slice(close + 1)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!body.length) errors.push('add one to three plain lines below the header')
  if (body.length > MAX_LINES)
    errors.push(`use at most ${MAX_LINES} lines below the header; found ${body.length}`)
  for (const line of body)
    if (/^(?:#|[-*+>]\s|\d+\.\s)/.test(line))
      errors.push(`write plain sentences without headings or list markers: "${line}"`)
  if (errors.length) return { errors }
  return {
    fragment: {
      name,
      category,
      clients: CLIENTS.filter((client) => clients.includes(client)),
      text: body.join(' '),
      pull: /^\d+\.md$/.test(name) ? Number(name.slice(0, -3)) : undefined,
    },
  }
}

export function parseFragments(names, read) {
  const fragments = []
  const problems = []
  for (const name of names.toSorted()) {
    if (name === 'README.md') continue
    if (!isFragmentName(name)) {
      problems.push({ name, errors: ['only Markdown fragments (.md) belong in changelog.d'] })
      continue
    }
    const { fragment, errors } = parseFragment(name, read(name))
    if (errors) problems.push({ name, errors })
    else fragments.push(fragment)
  }
  return { fragments, problems }
}

/** Reads every fragment in a directory. Returns parsed fragments and per-file errors. */
export function readFragments(directory) {
  let names
  try {
    names = readdirSync(directory)
  } catch (error) {
    if (error.code === 'ENOENT') return { fragments: [], problems: [] }
    throw error
  }
  return parseFragments(names, (name) => readFileSync(join(directory, name), 'utf8'))
}

export function formatProblems(problems) {
  return problems
    .map(
      ({ name, errors }) =>
        `${FRAGMENT_DIRECTORY}/${name}:\n${errors.map((error) => `  - ${error}`).join('\n')}`,
    )
    .join('\n')
}

const byPullThenName = (left, right) =>
  (left.pull ?? Infinity) - (right.pull ?? Infinity) || left.name.localeCompare(right.name)

/** Renders fragments as Markdown, grouped by category in a fixed order. */
export function renderNotes(fragments, headingLevel = 3) {
  const heading = '#'.repeat(headingLevel)
  const sections = []
  for (const category of CATEGORIES) {
    const entries = fragments.filter((fragment) => fragment.category === category)
    if (!entries.length) continue
    const lines = entries.toSorted(byPullThenName).map(({ clients, text, pull }) => {
      const label = clients.join(', ')
      return `- ${label[0].toUpperCase()}${label.slice(1)}: ${text}${pull ? ` (#${pull})` : ''}`
    })
    sections.push(`${heading} ${category}\n\n${lines.join('\n')}`)
  }
  return sections.length ? `${sections.join('\n\n')}\n` : ''
}

const CHANGELOG_HEADER = `# Changelog

User-facing changes in each stable release. Add new entries to \`changelog.d/\`; see
[changelog.d/README.md](changelog.d/README.md).
`

const sectionStart = (line, version) =>
  line === `## ${version}` || line.startsWith(`## ${version} `)

/** Returns the body of the CHANGELOG.md section for a version, or an empty string. */
export function releaseSection(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => sectionStart(line, version))
  if (start === -1) return ''
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
  return body ? `${body}\n` : ''
}

/** Inserts a new release section above older releases. Rejects a version that already exists. */
export function insertRelease(changelog, { version, date, notes }) {
  const current = changelog || CHANGELOG_HEADER
  if (current.split('\n').some((line) => sectionStart(line, version)))
    throw new Error(`CHANGELOG.md already has a section for ${version}`)
  const section = `## ${version} (${date})\n\n${notes.trim()}\n`
  const lines = current.split('\n')
  const first = lines.findIndex((line) => line.startsWith('## '))
  if (first === -1) return `${current.trimEnd()}\n\n${section}`
  const before = lines.slice(0, first).join('\n').trimEnd()
  const after = lines.slice(first).join('\n')
  return `${before}\n\n${section}\n${after}`
}

const TEST_OR_DOC_SEGMENT =
  /(?:^|\/)(?:test|tests|__tests__|testing|fixtures|__fixtures__|__snapshots__|docs)\//
const TEST_OR_DOC_FILE = /(?:\.(?:test|spec)\.[^/]+|\.browser\.mjs|\.mdx?)$/

// The website, design catalog and review demo do not ship in Dovo Studio releases.
const UNRELEASED_APP = /^apps\/(?:site|design-system|review-demo)\//

/** True when a changed path is product code that users may notice. */
export function needsFragment(path) {
  if (!/^(?:apps|packages)\//.test(path) || UNRELEASED_APP.test(path)) return false
  return !TEST_OR_DOC_SEGMENT.test(path) && !TEST_OR_DOC_FILE.test(path)
}
