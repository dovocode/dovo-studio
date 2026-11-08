import { createHash } from 'node:crypto'
import { opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { readPiSessionFile } from './session-file.js'
import { piSessionMetadata } from './session-transcript.js'

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
const canonical = (path: string) =>
  realpath(path).catch((error: unknown) => {
    if (missing(error)) return resolve(path)
    throw error
  })
const within = (root: string, path: string) => {
  const rest = relative(root, path)
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
}

export function piSessionsDirectory(env: NodeJS.ProcessEnv, home: string) {
  const expand = (path: string) =>
    path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
  return resolve(
    expand(
      env.PI_CODING_AGENT_SESSION_DIR?.trim() ||
        join(env.PI_CODING_AGENT_DIR?.trim() || join(home, '.pi', 'agent'), 'sessions'),
    ),
  )
}

/** Pi stores files either directly in the configured directory or one project level below it. */
export async function discoverPiSessions(directory: string, projectRoots: string[]) {
  const base = await canonical(directory)
  const roots = await Promise.all(projectRoots.map(canonical))
  const sessions: Array<{
    key: string
    sessionId: string
    cwd: string
    path: string
    updatedAt: string
  }> = []
  let visited = 0,
    inspected = 0,
    limited = false
  const walk = async (directory: string, depth: number) => {
    let entries: Array<{ name: string; file: boolean; directory: boolean }> = []
    try {
      const handle = await opendir(directory)
      for await (const entry of handle) {
        if (++visited > 6000) {
          limited = true
          break
        }
        if (!entry.isSymbolicLink())
          entries.push({ name: entry.name, file: entry.isFile(), directory: entry.isDirectory() })
      }
    } catch (error) {
      if (missing(error)) return
      throw error
    }
    entries = entries.sort((a, b) => b.name.localeCompare(a.name))
    for (const entry of entries) {
      if (inspected >= 400) {
        limited = true
        break
      }
      const path = join(directory, entry.name)
      if (entry.directory && depth === 0 && visited <= 6000) await walk(path, depth + 1)
      if (!entry.file || !entry.name.endsWith('.jsonl')) continue
      inspected++
      const resolved = await realpath(path).catch((error: unknown) => {
        if (missing(error)) return undefined
        throw error
      })
      if (!resolved || !within(base, resolved)) continue
      const content = await readPiSessionFile(resolved, 'header').catch((error: unknown) => {
        if (missing(error)) return undefined
        throw error
      })
      if (!content) continue
      const metadata = piSessionMetadata(content.text)
      if (!metadata || !isAbsolute(metadata.cwd)) continue
      const cwd = await canonical(metadata.cwd)
      if (!roots.some((root) => within(root, cwd))) continue
      const key = createHash('sha256')
        .update(JSON.stringify([base, resolved, metadata.id]))
        .digest('hex')
      sessions.push({
        key,
        sessionId: metadata.id,
        cwd,
        path: resolved,
        updatedAt: content.info.mtime.toISOString(),
      })
    }
  }
  await walk(base, 0)
  return { sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), limited }
}
