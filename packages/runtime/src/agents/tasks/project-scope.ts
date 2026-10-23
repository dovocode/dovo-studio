import { open, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Repository } from '@dovo/protocol'

const summaries = [
  'README.md',
  'readme.md',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
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
])

/** Small, read-only discovery hints; the selector can inspect relevant source afterwards. */
export async function projectScopeContext(projects: readonly Repository[], signal: AbortSignal) {
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
            const entries = (await readdir(directory, { withFileTypes: true }))
              .filter(
                (entry) =>
                  !excluded.has(entry.name) &&
                  (!entry.name.startsWith('.') || entry.name === '.github'),
              )
              .sort((a, b) => a.name.localeCompare(b.name))
            const documents = await Promise.all(
              summaries
                .filter((file) => entries.some((entry) => entry.name === file && entry.isFile()))
                .map(async (file) => {
                  signal.throwIfAborted()
                  try {
                    const handle = await open(join(directory, file), 'r')
                    try {
                      const limit = Math.min(2048, budget)
                      const buffer = Buffer.alloc(limit + 1)
                      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
                      const text = buffer.subarray(0, Math.min(bytesRead, limit)).toString('utf8')
                      return {
                        evidence: text.includes('\0') ? '' : `\n${file} (excerpt):\n${text}`,
                        truncated: bytesRead > limit,
                      }
                    } finally {
                      await handle.close()
                    }
                  } catch (error) {
                    signal.throwIfAborted()
                    return {
                      evidence: `\n${file}: unavailable (${inspectionError(error)})`,
                      truncated: false,
                    }
                  }
                }),
            )
            signal.throwIfAborted()
            const evidence = `Top-level entries: ${entries
              .slice(0, 48)
              .map((entry) => entry.name.slice(0, 120) + (entry.isDirectory() ? '/' : ''))
              .join(', ')}${documents.map((document) => document.evidence).join('')}`
            return {
              id,
              name,
              path,
              gitIdentity,
              kind,
              inspection: {
                available: true,
                evidence: evidence.slice(0, budget),
                truncated:
                  evidence.length > budget ||
                  entries.length > 48 ||
                  documents.some((document) => document.truncated),
              },
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
                available: false,
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
