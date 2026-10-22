import type { Agent, NativeThreadEntry } from '@dovo/protocol'
import { opencodeHeaders, opencodeAddress, isOpencodeV2 } from './opencode-server.js'
import { opencodeThreadEntries } from '../../execution/native-thread.js'

export async function readOpencodeThread(
  agent: Agent,
  id: string,
  cwd?: string,
): Promise<NativeThreadEntry[]> {
  const headers = opencodeHeaders(agent.env)
  const baseUrl = opencodeAddress(agent.endpoint)
  if (await isOpencodeV2(baseUrl, agent.env)) {
    const { OpenCode } = await import('@opencode/client')
    const api = OpenCode.make({ baseUrl, headers })
    const entries: NativeThreadEntry[] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await api.message.list(
        { sessionID: id, limit: 100, order: 'asc', cursor },
        { signal: AbortSignal.timeout(5000) },
      )
      entries.push(...opencodeThreadEntries(page.data))
      cursor = page.cursor.next ?? undefined
      if (cursor && seen.has(cursor))
        throw new Error('OpenCode returned a repeated conversation cursor')
      if (cursor) seen.add(cursor)
    } while (cursor)
    return entries
  }
  const { createOpencodeClient } = await import('@opencode-ai/sdk/v2')
  const api = createOpencodeClient({ baseUrl, headers, directory: cwd, throwOnError: true })
  const result = await api.session.messages(
    { sessionID: id, directory: cwd },
    { signal: AbortSignal.timeout(5000), throwOnError: true },
  )
  return opencodeThreadEntries(result.data)
}
