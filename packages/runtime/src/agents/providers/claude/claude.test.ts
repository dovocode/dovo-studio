import { decode, resourceSettingsSchema } from '@dovo/protocol'
import { taskToolsServer } from '../../../agent-tools/config.js'
import * as warmProcesses from '../../execution/warm-processes.js'
import { expect, it, vi } from 'vitest'
import type { AgentRun } from '../../execution/types.js'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

const mocks = vi.hoisted(() => ({
  query: vi.fn<(input: { prompt: string | AsyncIterable<SDKUserMessage> }) => unknown>(),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../../configuration/claude-command.js', () => ({
  claudeCommand: async () => '/bin/claude',
}))

import { claudeAdapter } from './claude.js'

it('runs the Claude compact command and reports its boundary', async () => {
  mocks.query.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'manual', pre_tokens: 1000 },
      }
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
    },
    close: vi.fn<() => void>(),
  }))
  const events: string[] = []
  const run: AgentRun = {
    agent: {
      id: 'agent',
      name: 'Claude',
      provider: 'claude',
      endpoint: '',
      model: '',
      instructions: '',
      permission: 'ask',
      args: ['--verbose', '--settings=/config with spaces'],
      env: { TEST_AGENT_ENV: 'configured' },
    },
    cwd: '/tmp',
    prompt: '/compact',
    compact: true,
    sessionId: 'session',
    signal: new AbortController().signal,
    onSession: () => {},
    onText: () => {},
    onActivity: () => {},
    onEvent: (name) => events.push(name),
    approve: async () => false,
    ask: async () => null,
  }
  await claudeAdapter.run(run)
  expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ prompt: '/compact' }))
  expect(mocks.query).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        extraArgs: { verbose: null, settings: '/config with spaces' },
        env: expect.objectContaining({ TEST_AGENT_ENV: 'configured' }),
        settingSources: ['user', 'project', 'local'],
      }),
    }),
  )
  expect(events).toContain('system')
  mocks.query.mockClear()
  await claudeAdapter.run({ ...run, compact: undefined, sessionId: undefined, ephemeral: true })
  expect(mocks.query).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        persistSession: false,
        settingSources: ['user', 'project', 'local'],
      }),
    }),
  )
  mocks.query.mockClear()
  await claudeAdapter.run({
    ...run,
    compact: undefined,
    sessionId: undefined,
    ephemeral: true,
    tools: 'none',
  })
  expect(mocks.query).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        settingSources: [],
        tools: [],
        strictMcpConfig: true,
        mcpServers: {},
      }),
    }),
  )
})
it('keeps a streaming Claude connection across turns', async () => {
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  mocks.query.mockClear()
  const prompts: string[] = []
  const output: string[] = []
  const setMcpServers = vi
    .fn<
      (
        servers: Record<string, unknown>,
      ) => Promise<{ added: string[]; removed: string[]; errors: Record<string, string> }>
    >()
    .mockResolvedValue({ added: ['dovo_task'], removed: [], errors: {} })
  const close = vi.fn<() => void>()
  mocks.query.mockImplementation(({ prompt }) => ({
    async *[Symbol.asyncIterator]() {
      if (typeof prompt === 'string') throw new Error('Expected streaming input')
      for await (const message of prompt) {
        const content = message.message.content
        prompts.push(
          typeof content === 'string'
            ? content
            : (content.find((block) => block.type === 'text')?.text ?? ''),
        )
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Reply' } },
        }
        yield { type: 'stream_event', event: { type: 'message_stop' } }
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
      }
    },
    close,
    setMcpServers,
  }))
  const run: AgentRun = {
    agent: {
      id: 'agent',
      name: 'Claude',
      provider: 'claude',
      endpoint: '',
      model: '',
      instructions: '',
      permission: 'ask',
    },
    taskId: 'warm-claude-task',
    cwd: '/tmp',
    prompt: 'first',
    signal: new AbortController().signal,
    onSession: () => {},
    onText: (text) => output.push(text),
    onTextBoundary: () => output.push('boundary'),
    onActivity: () => {},
    approve: async () => false,
    ask: async () => null,
  }
  try {
    const boundRun = (attempt: string): AgentRun => ({
      ...run,
      agent: {
        ...run.agent,
        resources: decode(resourceSettingsSchema, {
          mcpServers: [
            taskToolsServer(run.taskId!, 1234, 'token', '127.0.0.1', false, false, attempt),
          ],
        }),
      },
    })
    await claudeAdapter.run(boundRun('first-run'))
    await claudeAdapter.run({ ...boundRun('second-run'), sessionId: 'session', prompt: 'second' })
    expect(setMcpServers).toHaveBeenCalledWith(
      expect.objectContaining({
        dovo_task: expect.objectContaining({
          env: expect.objectContaining({ DOVO_TASK_RUN_ID: 'second-run' }),
        }),
      }),
    )
    expect(prompts).toEqual(['first', 'second'])
    expect(output).toEqual(['Reply', 'boundary', 'Reply', 'boundary'])
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ settingSources: ['user', 'project', 'local'] }),
      }),
    )
    setMcpServers.mockResolvedValueOnce({
      added: [],
      removed: [],
      errors: { dovo_task: 'connection failed' },
    })
    await expect(
      claudeAdapter.run({ ...boundRun('third-run'), sessionId: 'session', prompt: 'third' }),
    ).rejects.toThrow('dovo_task: connection failed')
    expect(prompts).toEqual(['first', 'second'])
  } finally {
    await claudeAdapter.dispose?.()
    pressure.mockRestore()
  }
  expect(close).toHaveBeenCalled()
})
