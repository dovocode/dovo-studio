import { open, realpath, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { Schema } from 'effect'
import { decodeResult } from '@dovo/protocol'
import type { Agent } from '@dovo/protocol'
import { processEnvironment } from '../../../process.js'
import { claudeThreadEntries } from '../../execution/native-thread.js'

const lineSchema = Schema.Struct({
  uuid: Schema.String,
  type: Schema.String,
  message: Schema.Unknown,
  isMeta: Schema.optional(Schema.Boolean),
})

/** Native workflow members do not stream SDK messages. Read their provider transcript on demand. */
export async function readClaudeWorkflowThread(agent: Agent, file: string, cwd?: string) {
  const env = processEnvironment(agent.env)
  const home = env.HOME || homedir()
  const configured = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  const directory = resolve(
    cwd || home,
    configured.startsWith('~/') ? join(home, configured.slice(2)) : configured,
  )
  if (
    !isAbsolute(file) ||
    extname(file) !== '.jsonl' ||
    !/^agent-[\w-]+\.jsonl$/.test(basename(file))
  )
    throw new Error('Invalid Claude workflow transcript path')
  let root: string, resolved: string
  try {
    root = await realpath(join(directory, 'projects'))
    resolved = await realpath(file)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  const path = relative(root, resolved)
  if (
    path === '..' ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path) ||
    !path ||
    extname(resolved) !== '.jsonl'
  )
    throw new Error('Claude workflow transcript is outside the configured projects directory')
  const handle = await open(
    resolved,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  )
  try {
    const stat = await handle.stat(),
      current = await lstat(resolved)
    if (!stat.isFile() || stat.ino !== current.ino || stat.dev !== current.dev)
      throw new Error('Claude workflow transcript changed during reading')
    const cap = 2 * 1024 * 1024
    const start = Math.max(0, stat.size - cap)
    const buffer = Buffer.alloc(Math.min(stat.size, cap))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    const bytes = buffer.subarray(0, bytesRead)
    const end = bytes.lastIndexOf(0x0a)
    if (end < 0) return []
    // Ignore incomplete lines at either boundary. A refresh can read a late final reply.
    const contents = bytes.subarray(start ? bytes.indexOf(0x0a) + 1 : 0, end).toString('utf8')
    const messages = contents.split('\n').flatMap((line) => {
      if (!line.trim()) return []
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        throw new Error('Invalid Claude workflow transcript record')
      }
      const decoded = decodeResult(lineSchema, value).data
      return decoded && !decoded.isMeta && ['user', 'assistant'].includes(decoded.type)
        ? [decoded]
        : []
    })
    const entries = claudeThreadEntries(messages)
    return start
      ? [
          {
            id: 'workflow-truncated',
            role: 'tool' as const,
            label: 'Earlier history omitted',
            text: 'Showing the most recent 2 MiB of this workflow transcript.',
          },
          ...entries,
        ]
      : entries
  } finally {
    await handle.close()
  }
}
