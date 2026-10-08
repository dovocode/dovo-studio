import { decode, resourceSettingsSchema } from '@dovo/protocol'
import { taskToolsServer } from '../../../agent-tools/config.js'
import * as warmProcesses from '../../execution/warm-processes.js'
import { expect, it, vi } from 'vite-plus/test'
import type { AgentRun } from '../../execution/types.js'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

const mocks = vi.hoisted(() => ({
  query: vi.fn<(input: { prompt: string | AsyncIterable<SDKUserMessage> }) => unknown>(),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../../configuration/claude-command.js', () => ({
  claudeCommand: async () => '/bin/claude',
}))

import { claudeAdapter, createClaudeAdapter } from './claude.js'

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
  const events: string[] = []
  let resolveAccount: (account: { subscriptionType: string }) => void = () => {}
  const metadata = new Promise<{ subscriptionType: string }>((resolve) => {
    resolveAccount = resolve
  })
  const accountInfo = vi.fn<() => typeof metadata>(() => metadata)
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
    accountInfo,
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
    onEvent: (name) => events.push(name),
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
    // A completed reply must not wait for optional metadata or receive it late.
    resolveAccount({ subscriptionType: 'test' })
    await metadata
    expect(events).not.toContain('account/info')
    await claudeAdapter.run({ ...boundRun('second-run'), sessionId: 'session', prompt: 'second' })
    expect(accountInfo).toHaveBeenCalledOnce()
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

it('continues native-agent discovery after a warm parent turn ends and rebinds it for the next turn', async () => {
  const adapter = createClaudeAdapter()
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  let release = () => {}
  const late = new Promise<void>((resolve) => {
    release = resolve
  })
  mocks.query.mockImplementation(({ prompt }) => ({
    async *[Symbol.asyncIterator]() {
      if (typeof prompt === 'string') throw new Error('Expected streaming input')
      for await (const _message of prompt) {
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
        await late
        yield {
          type: 'system',
          subtype: 'background_tasks_changed',
          session_id: 'session',
          tasks: [{ task_id: 'native-child', task_type: 'local_agent', description: 'Explore' }],
        }
      }
    },
    close: release,
  }))
  const native = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  const events = vi.fn<NonNullable<AgentRun['onEvent']>>()
  const run: AgentRun = {
    taskId: 'native-claude',
    agent: {
      id: 'agent',
      name: 'Claude',
      provider: 'claude',
      endpoint: '',
      model: '',
      instructions: '',
      permission: 'ask',
    },
    cwd: '/tmp',
    prompt: 'First',
    signal: new AbortController().signal,
    onSession: () => {},
    onText: () => {},
    onActivity: () => {},
    onEvent: events,
    onSubagentEvent: native,
    approve: async () => false,
    ask: async () => null,
  }
  try {
    await adapter.run(run)
    release()
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith(
        'system',
        expect.objectContaining({ subtype: 'background_tasks_changed' }),
        'session',
      ),
    )
    expect(events).not.toHaveBeenCalledWith(
      'system',
      expect.objectContaining({ subtype: 'background_tasks_changed' }),
    )
    const rebound = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
    await adapter.run({ ...run, sessionId: 'session', prompt: 'Second', onSubagentEvent: rebound })
    await vi.waitFor(() =>
      expect(rebound).toHaveBeenCalledWith(
        'system',
        expect.objectContaining({ subtype: 'background_tasks_changed' }),
        'session',
      ),
    )
    await adapter.dispose?.()
    expect(rebound).toHaveBeenCalledWith('dovo/session/closed', {}, 'session')
  } finally {
    release()
    await adapter.dispose?.()
    pressure.mockRestore()
  }
})
