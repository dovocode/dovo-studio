import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@dovo/protocol'
import { transcriptUsage, UsageTranscripts } from './usage-transcripts.js'
import { openCodeUsage } from './usage-opencode.js'
afterEach(() => vi.useRealTimers())

it('evicts deleted transcripts, removed sources and aged rows from retained scans', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-transcript-retention-'))
  const source = join(directory, 'projects')
  const path = join(source, 'session.jsonl')
  try {
    await mkdir(source)
    const timestamp = new Date(Date.now() - 89 * 86400000).toISOString()
    await writeFile(
      path,
      JSON.stringify({
        type: 'assistant',
        sessionId: 'session',
        timestamp,
        message: { id: 'message', model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } },
      }) + '\n',
    )
    const agent: Agent = {
      id: 'claude',
      name: 'Claude',
      provider: 'claude',
      model: '',
      instructions: '',
      endpoint: '',
      permission: 'ask',
      env: { CLAUDE_CONFIG_DIR: directory },
    }
    const usage = new UsageTranscripts()
    expect((await usage.read([agent], new Set(), true)).records).toHaveLength(1)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 2 * 86400000)
    expect((await usage.read([agent], new Set(), true)).records).toHaveLength(0)
    expect(usage['cache'].get(path)?.rows).toHaveLength(0)
    await rm(path)
    await usage.read([agent], new Set(), true)
    expect(usage['cache'].size).toBe(0)
    await writeFile(
      path,
      JSON.stringify({
        type: 'assistant',
        sessionId: 'session',
        timestamp: new Date().toISOString(),
        message: { id: 'message', model: 'claude', usage: { input_tokens: 10, output_tokens: 5 } },
      }) + '\n',
    )
    await usage.read([agent], new Set(), true)
    expect(usage['cache'].size).toBe(1)
    await usage.read([], new Set(), true)
    expect(usage['cache'].size).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('deduplicates cumulative Codex notifications and keeps cache input disjoint', () => {
  const event = {
    type: 'event_msg',
    timestamp: '2026-10-01T00:00:00Z',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { total_tokens: 130 },
        last_token_usage: { input_tokens: 100, output_tokens: 30, cached_input_tokens: 70 },
      },
    },
  }
  const rows = transcriptUsage(
    'codex',
    [
      { type: 'session_meta', payload: { id: 'session' } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      event,
      event,
    ],
    'path',
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    sessionId: 'session',
    turn: {
      tokens: 130,
      model: 'gpt-6.1-sol',
      tokenUsage: { input: 30, output: 30, cacheRead: 70 },
    },
  })
})
it('replaces repeated Claude message updates and counts cache creation separately', () => {
  const event = {
    type: 'assistant',
    sessionId: 'session',
    timestamp: '2026-10-01T00:00:00Z',
    message: {
      id: 'm',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 70,
        cache_creation_input_tokens: 15,
      },
    },
  }
  const rows = transcriptUsage(
    'claude',
    [
      event,
      {
        ...event,
        message: { ...event.message, usage: { ...event.message.usage, output_tokens: 8 } },
      },
    ],
    'path',
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.turn.tokens).toBe(103)
})
it('reads OpenCode token categories and does not mistake unknown zero cost for free billing', () => {
  const row = openCodeUsage({
    role: 'assistant',
    id: 'm',
    sessionID: 's',
    modelID: 'custom',
    providerID: 'provider',
    time: { created: Date.parse('2026-10-01T00:00:00Z') },
    tokens: { input: 10, output: 5, reasoning: 3, cache: { read: 20, write: 2 } },
    cost: 0,
  })
  expect(row?.turn).toMatchObject({
    model: 'provider/custom',
    tokens: 40,
    tokenUsage: { input: 10, output: 8, cacheRead: 20, cacheWrite: 2 },
  })
  expect(row?.turn.costSource).toBeUndefined()
})
