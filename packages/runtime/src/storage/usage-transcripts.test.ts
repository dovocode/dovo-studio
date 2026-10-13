import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  appendFile,
  mkdtemp,
  mkdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  utimes,
} from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@dovo/protocol'
import { transcriptUsage, UsageTranscripts } from './usage-transcripts.js'
import { openCodeUsage } from './usage-opencode.js'
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, createReadStream: vi.fn<typeof fs.createReadStream>(fs.createReadStream) }
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('evicts deleted transcripts, removed sources and aged rows from retained scans', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-transcript-retention-'))
  const configured = join(directory, 'config')
  const source = join(configured, 'projects')
  const path = join(source, 'session.jsonl')
  try {
    await mkdir(join(directory, 'projects'))
    await symlink(directory, configured, process.platform === 'win32' ? 'junction' : 'dir')
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
    const canonicalPath = await realpath(path)
    const agent: Agent = {
      id: 'claude',
      name: 'Claude',
      provider: 'claude',
      model: '',
      instructions: '',
      endpoint: '',
      permission: 'ask',
      env: { CLAUDE_CONFIG_DIR: configured },
    }
    const usage = new UsageTranscripts()
    expect((await usage.read([agent], new Set(), true)).records).toHaveLength(1)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 2 * 86400000)
    expect((await usage.read([agent], new Set(), true)).records).toHaveLength(0)
    expect(usage['cache'].get(canonicalPath)?.parser.records()).toHaveLength(0)
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

function cliAgent(provider: 'codex' | 'claude', directory: string): Agent {
  return {
    id: provider,
    name: provider,
    provider,
    model: '',
    instructions: '',
    endpoint: '',
    permission: 'ask',
    env: provider === 'codex' ? { CODEX_HOME: directory } : { CLAUDE_CONFIG_DIR: directory },
  }
}
function claudeEvent(id: string, output = 5, timestamp = new Date().toISOString()) {
  return {
    type: 'assistant',
    sessionId: 'session',
    timestamp,
    message: { id, model: 'claude-🙂', usage: { input_tokens: 10, output_tokens: output } },
  }
}
function codexEvent(total: number, timestamp = new Date().toISOString()) {
  return {
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 3 },
      },
    },
  }
}
it('reads only appended bytes and preserves Codex session, model and cumulative dedupe across refreshes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-usage-append-'))
  const source = join(directory, 'sessions')
  const path = join(source, 'session.jsonl')
  const agent = cliAgent('codex', directory)
  const usage = new UsageTranscripts()
  const lines: unknown[] = [
    { type: 'session_meta', payload: { id: 'session' } },
    { type: 'turn_context', payload: { model: 'model-one' } },
    codexEvent(15),
  ]
  const encode = (events: readonly unknown[]) =>
    events.map((event) => JSON.stringify(event) + '\n').join('')
  try {
    await mkdir(source)
    const initial = encode(lines)
    await writeFile(path, initial)
    expect((await usage.read([agent], new Set(), true)).records).toEqual(
      transcriptUsage('codex', lines, path),
    )
    vi.mocked(createReadStream).mockClear()
    await usage.read([agent], new Set(), true)
    expect(createReadStream).not.toHaveBeenCalled()
    const appended = [
      codexEvent(15),
      { type: 'turn_context', payload: { model: 'model-two' } },
      codexEvent(30),
    ]
    lines.push(...appended)
    await appendFile(path, encode(appended))
    expect((await usage.read([agent], new Set(), true)).records).toEqual(
      transcriptUsage('codex', lines, path),
    )
    expect(createReadStream).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createReadStream).mock.calls[0]?.[1]).toMatchObject({
      start: Buffer.byteLength(initial),
    })
    expect((await usage.read([agent], new Set(['codex:session']), true)).records).toEqual([])
    expect((await usage.read([agent], new Set(), true)).records).toHaveLength(2)
    expect((await new UsageTranscripts().read([agent], new Set(), true)).records).toEqual(
      transcriptUsage('codex', lines, path),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('handles partial UTF-8 lines, unterminated records and repeated Claude message updates without double counting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-usage-partial-'))
  const source = join(directory, 'projects')
  const path = join(source, 'session.jsonl')
  const agent = cliAgent('claude', directory)
  const usage = new UsageTranscripts()
  const first = claudeEvent('first')
  const next = claudeEvent('first', 8)
  const encoded = Buffer.from(JSON.stringify(next))
  const split = encoded.indexOf(Buffer.from('🙂')) + 2
  try {
    await mkdir(source)
    await writeFile(path, JSON.stringify(first) + '\r\n')
    await usage.read([agent], new Set(), true)
    await appendFile(path, encoded.subarray(0, split))
    const partial = await usage.read([agent], new Set(), true)
    expect(partial.records).toEqual(transcriptUsage('claude', [first], path))
    expect(partial.notices).toEqual([])
    await appendFile(path, encoded.subarray(split))
    const preview = await usage.read([agent], new Set(), true)
    expect(preview.records).toEqual(transcriptUsage('claude', [first, next], path))
    expect((await new UsageTranscripts().read([agent], new Set(), true)).records).toEqual(
      preview.records,
    )
    const third = claudeEvent('third')
    await appendFile(path, '\n' + JSON.stringify(third) + '\n')
    expect((await usage.read([agent], new Set(), true)).records).toEqual(
      transcriptUsage('claude', [first, next, third], path),
    )
    await appendFile(path, '{"type":"assistant",broken}\n')
    expect((await usage.read([agent], new Set(), true)).notices).toContain(
      'claude: skipped an incomplete transcript row.',
    )
    expect((await usage.read([agent], new Set(), true)).notices).toContain(
      'claude: skipped an incomplete transcript row.',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('resets state after truncation, inode replacement, equal-size rewrites and truncate/regrow between reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-usage-rotation-'))
  const source = join(directory, 'projects')
  const path = join(source, 'session.jsonl')
  const agent = cliAgent('claude', directory)
  const usage = new UsageTranscripts()
  const timestamp = new Date().toISOString()
  const encode = (id: string, padding = '') =>
    JSON.stringify({ ...claudeEvent(id, 5, timestamp), padding }) + '\n'
  try {
    await mkdir(source)
    await writeFile(path, encode('original', 'x'.repeat(1000)))
    await usage.read([agent], new Set(), true)
    await writeFile(path, encode('short'))
    expect((await usage.read([agent], new Set(), true)).records[0]?.turn.assistantId).toBe('short')
    await rename(path, path + '.old')
    await writeFile(path, encode('replacement', 'x'.repeat(1000)))
    expect(
      (await usage.read([agent], new Set(), true)).records.map((row) => row.turn.assistantId),
    ).toEqual(['replacement'])
    await writeFile(path, encode('same-length', 'x'.repeat(1000)))
    await utimes(path, new Date(), new Date(Date.now() + 1000))
    expect(
      (await usage.read([agent], new Set(), true)).records.map((row) => row.turn.assistantId),
    ).toEqual(['same-length'])
    await writeFile(path, encode('grown', 'y'.repeat(2000)))
    expect(
      (await usage.read([agent], new Set(), true)).records.map((row) => row.turn.assistantId),
    ).toEqual(['grown'])
    await writeFile(path, '')
    expect((await usage.read([agent], new Set(), true)).records).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('includes the exact retention boundary and ages Codex dedupe state with its rows', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
  const directory = await mkdtemp(join(tmpdir(), 'dovo-usage-boundary-'))
  const source = join(directory, 'sessions')
  const path = join(source, 'session.jsonl')
  const agent = cliAgent('codex', directory)
  const usage = new UsageTranscripts()
  const boundary = Date.now() - 90 * 86400000
  try {
    await mkdir(source)
    await writeFile(
      path,
      [
        { type: 'session_meta', payload: { id: 'session' } },
        { type: 'turn_context', payload: { model: 'model' } },
        codexEvent(10, new Date(boundary - 1).toISOString()),
        codexEvent(15, new Date(boundary).toISOString()),
      ]
        .map((event) => JSON.stringify(event) + '\n')
        .join(''),
    )
    expect((await usage.read([agent], new Set(), true)).records).toHaveLength(1)
    vi.setSystemTime(Date.now() + 1)
    const fresh = codexEvent(15)
    await appendFile(path, JSON.stringify(fresh) + '\n')
    const result = await usage.read([agent], new Set(), true)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.turn.startedAt).toBe(fresh.timestamp)
    expect((await new UsageTranscripts().read([agent], new Set(), true)).records).toEqual(
      result.records,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('promotes a newer duplicate when the first Codex notification ages out of retention', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
  const directory = await mkdtemp(join(tmpdir(), 'dovo-usage-duplicate-age-'))
  const source = join(directory, 'sessions')
  const path = join(source, 'session.jsonl')
  const agent = cliAgent('codex', directory)
  const usage = new UsageTranscripts()
  try {
    await mkdir(source)
    const first = codexEvent(15, new Date(Date.now() - 90 * 86400000).toISOString())
    const duplicate = codexEvent(15)
    await writeFile(path, [first, duplicate].map((event) => JSON.stringify(event) + '\n').join(''))
    expect((await usage.read([agent], new Set(), true)).records[0]?.turn.startedAt).toBe(
      first.timestamp,
    )
    vi.setSystemTime(Date.now() + 1)
    const result = await usage.read([agent], new Set(), true)
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.turn.startedAt).toBe(duplicate.timestamp)
    expect((await new UsageTranscripts().read([agent], new Set(), true)).records).toEqual(
      result.records,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('keeps concurrent reads with different known-session exclusions separate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-usage-exclusions-'))
  const source = join(directory, 'projects')
  const path = join(source, 'session.jsonl')
  const agent = cliAgent('claude', directory)
  const usage = new UsageTranscripts()
  try {
    await mkdir(source)
    await writeFile(path, JSON.stringify(claudeEvent('first')) + '\n')
    const [included, excluded] = await Promise.all([
      usage.read([agent], new Set(), true),
      usage.read([agent], new Set(['claude:session']), true),
    ])
    expect(included.records).toHaveLength(1)
    expect(excluded.records).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('rebuilds expired malformed Codex dedupe baselines so valid copies are not lost', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
  const directory = await mkdtemp(join(tmpdir(), 'dovo-usage-invalid-age-'))
  const source = join(directory, 'sessions')
  const path = join(source, 'session.jsonl')
  const agent = cliAgent('codex', directory)
  const usage = new UsageTranscripts()
  try {
    await mkdir(source)
    const first = codexEvent(15, new Date(Date.now() - 90 * 86400000).toISOString())
    const invalid = {
      ...first,
      payload: { ...first.payload, info: { ...first.payload.info, last_token_usage: {} } },
    }
    const duplicate = codexEvent(15)
    await writeFile(
      path,
      [invalid, duplicate].map((event) => JSON.stringify(event) + '\n').join(''),
    )
    expect((await usage.read([agent], new Set(), true)).records).toEqual([])
    vi.setSystemTime(Date.now() + 1)
    const result = await usage.read([agent], new Set(), true)
    expect(result.records).toHaveLength(1)
    expect((await new UsageTranscripts().read([agent], new Set(), true)).records).toEqual(
      result.records,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
