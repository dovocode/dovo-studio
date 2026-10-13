import { getSubagentMessages, type SessionStore } from '@anthropic-ai/claude-agent-sdk'
import type { Agent } from '@dovo/protocol'
import { decode, mutableArray, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { readFile } from 'node:fs/promises'
import { relative, resolve, isAbsolute } from 'node:path'
import { claudeThreadEntries } from '../../execution/native-thread.js'

const stored = Schema.StructWithRest(mutableStruct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Unknown),
])
/** Use the SDK's transcript-chain reader, including for custom Claude configuration roots. */
export async function readClaudeThread(
  agent: Agent,
  id: string,
  sessionId: string | undefined,
  cwd?: string,
) {
  if (!sessionId) return []
  const root = agent.env?.CLAUDE_CONFIG_DIR
  let sessionStore: SessionStore | undefined
  if (root)
    sessionStore = {
      append: async () => {
        throw new Error('Native thread readers cannot write provider transcripts')
      },
      load: async (key) => {
        const projects = resolve(root, 'projects')
        const file = key.subpath
          ? resolve(projects, key.projectKey, key.sessionId, `${key.subpath}.jsonl`)
          : resolve(projects, key.projectKey, `${key.sessionId}.jsonl`)
        const path = relative(projects, file)
        if (
          path === '..' ||
          path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
          isAbsolute(path)
        )
          throw new Error('Invalid native transcript path')
        let content: string
        try {
          content = await readFile(file, 'utf8')
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
          throw error
        }
        // A running provider may still be appending its final line. Let the SDK
        // resolve the conversation chain from complete JSONL records only.
        const lines = content.split('\n').filter((line) => line.trim())
        const values = lines.flatMap((line, index) => {
          try {
            return [JSON.parse(line)]
          } catch (error) {
            if (
              index === lines.length - 1 &&
              !content.endsWith('\n') &&
              error instanceof SyntaxError
            )
              return []
            throw error
          }
        })
        return decode(mutableArray(stored), values)
      },
    }
  return claudeThreadEntries(await getSubagentMessages(sessionId, id, { dir: cwd, sessionStore }))
}
