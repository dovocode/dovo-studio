import { open, readdir, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename } from 'node:path'
import type { Repository } from '@dovo/protocol'
import { safeFile } from '../../scm/repositories/paths.js'

const summaries = [
  'README.md',
  'readme.md',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pnpm-workspace.yaml',
  'nx.json',
  'turbo.json',
]
const excluded = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.expo',
  'vendor',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  'Pods',
])

const containers = new Set([
  'apps',
  'packages',
  'services',
  'modules',
  'src',
  'lib',
  'tests',
  'docs',
])

/** Bound traversal as well as output; package names and dependency edges help identify owners. */
async function discover(directory: string, budget: number, request: string, signal: AbortSignal) {
  const terms = [...new Set(request.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])].slice(
    0,
    64,
  )
  const relevance = (path: string) =>
    terms.filter((term) => path.toLowerCase().includes(term)).length
  const pending = [{ path: '', depth: 0 }]
  const paths: string[] = [],
    documents: string[] = []
  let truncated = false,
    visited = 0
  while (pending.length && visited < 64) {
    signal.throwIfAborted()
    pending.sort(
      (a, b) =>
        relevance(b.path) - relevance(a.path) || a.depth - b.depth || a.path.localeCompare(b.path),
    )
    const current = pending.shift()!
    visited++
    try {
      const all = (
        await readdir(await safeFile(directory, current.path || '.'), { withFileTypes: true })
      )
        .filter(
          (entry) =>
            !excluded.has(entry.name) && (!entry.name.startsWith('.') || entry.name === '.github'),
        )
        .sort(
          (a, b) =>
            relevance(b.name) - relevance(a.name) ||
            Number(containers.has(b.name)) - Number(containers.has(a.name)) ||
            a.name.localeCompare(b.name),
        )
      const entries = all.slice(0, 128)
      truncated ||= entries.length < all.length
      for (const entry of entries) {
        const path = current.path ? `${current.path}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          paths.push(`${path}/`)
          if (current.depth < 3) pending.push({ path, depth: current.depth + 1 })
          else truncated = true
        } else if (entry.isFile()) {
          // File names give the selector a source map without reading source or secrets.
          paths.push(path)
          if (summaries.includes(entry.name)) documents.push(path)
        }
      }
    } catch (error) {
      signal.throwIfAborted()
      if (!current.path) throw error
      truncated = true
    }
  }
  truncated ||= pending.length > 0
  const map = paths
    .sort((a, b) => relevance(b) - relevance(a) || a.localeCompare(b))
    .slice(0, 96)
    .join(', ')
  const mapLimit = Math.min(2400, Math.floor(budget / 3))
  const evidence = [`Project paths (bounded, up to 4 levels): ${map.slice(0, mapLimit)}`]
  truncated ||= paths.length > 96 || map.length > mapLimit
  documents.sort((a, b) => {
    const score = (path: string) =>
      relevance(path) * 4 +
      (basename(path) === 'package.json' ? 3 : 0) +
      (!path.includes('/') ? 100 : 0)
    return score(b) - score(a) || a.localeCompare(b)
  })
  const selected = documents.slice(0, Math.min(16, Math.max(2, Math.floor(budget / 400))))
  const documentLimit = Math.min(
    2048,
    Math.max(
      1,
      Math.floor(
        (budget - evidence[0]!.length - selected.length * 80) / Math.max(1, selected.length),
      ),
    ),
  )
  truncated ||= selected.length < documents.length
  for (const path of selected) {
    signal.throwIfAborted()
    try {
      const handle = await open(
        await safeFile(directory, path),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      )
      try {
        if (!(await handle.stat()).isFile()) continue
        const limit = basename(path) === 'package.json' ? 65536 : documentLimit
        const buffer = Buffer.alloc(limit + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        let content = buffer.subarray(0, Math.min(bytesRead, limit)).toString('utf8')
        if (content.includes('\0')) continue
        if (basename(path) === 'package.json' && bytesRead <= limit) {
          try {
            const value: unknown = JSON.parse(content)
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              const manifest = new Map(Object.entries(value))
              content = JSON.stringify(
                Object.fromEntries(
                  [
                    'name',
                    'description',
                    'workspaces',
                    'dependencies',
                    'peerDependencies',
                    'optionalDependencies',
                    'devDependencies',
                  ].flatMap((key) => {
                    const field = manifest.get(key)
                    if (field === undefined) return []
                    return [
                      [
                        key,
                        key.endsWith('Dependencies') || key === 'dependencies'
                          ? field && typeof field === 'object' && !Array.isArray(field)
                            ? Object.keys(field)
                            : []
                          : field,
                      ],
                    ]
                  }),
                ),
              )
            }
          } catch {
            /* An incomplete manifest remains useful as an excerpt. */
          }
        }
        evidence.push(`\n${path} (excerpt):\n${content.slice(0, documentLimit)}`)
        truncated ||= bytesRead > limit || content.length > documentLimit
      } finally {
        await handle.close()
      }
    } catch (error) {
      signal.throwIfAborted()
      truncated = true
      evidence.push(`\n${path}: unavailable (${inspectionError(error)})`)
    }
  }
  const text = evidence.join('')
  return {
    available: true as const,
    evidence: text.slice(0, budget),
    truncated: truncated || text.length > budget,
  }
}

/** Small, read-only discovery hints; the selector can inspect relevant source afterwards. */
export async function projectScopeContext(
  projects: readonly Repository[],
  signal: AbortSignal,
  request = '',
) {
  const budget = Math.min(8000, Math.floor(96000 / Math.max(1, projects.length)))
  const catalog = []
  for (let offset = 0; offset < projects.length; offset += 8) {
    catalog.push(
      ...(await Promise.all(
        projects.slice(offset, offset + 8).map(async ({ id, name, path, gitIdentity, kind }) => {
          signal.throwIfAborted()
          try {
            const directory = await realpath(path)
            if (!(await stat(directory)).isDirectory()) throw new Error('Not a directory')
            const inspection = await discover(directory, budget, request, signal)
            signal.throwIfAborted()
            return {
              id,
              name,
              path,
              gitIdentity,
              kind,
              inspection,
              directory,
            }
          } catch (error) {
            signal.throwIfAborted()
            return {
              id,
              name,
              path,
              gitIdentity,
              kind,
              inspection: {
                available: false as const,
                error: inspectionError(error),
              },
            }
          }
        }),
      )),
    )
  }
  return {
    projects: catalog.map(({ directory: _directory, ...project }) => project),
    directories: catalog.flatMap((project) =>
      project.directory
        ? [{ id: project.id, path: project.directory, access: 'read-only' as const }]
        : [],
    ),
  }
}

function inspectionError(error: unknown) {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'Could not inspect project folder'
}
