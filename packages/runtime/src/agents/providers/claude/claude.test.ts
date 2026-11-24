import { existsSync, readFileSync } from 'node:fs'
import { decode, resourceSettingsSchema } from '@dovo/protocol'
import { taskToolsServer } from '../../../agent-tools/config.js'
import * as warmProcesses from '../../execution/warm-processes.js'
import { expect, it, vi } from 'vite-plus/test'
import type { AgentRun, NativeAgentSession } from '../../execution/types.js'
import type { Options, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk'

const mocks = vi.hoisted(() => ({
  prewarm: vi.fn<(input: unknown) => Promise<unknown>>(async () => {
    throw new Error('No spare in this fixture')
  }),
  query:
    vi.fn<
      (input: { prompt: string | AsyncIterable<SDKUserMessage>; options: Options }) => unknown
    >(),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('@anthropic-ai/claude-agent-sdk/core', () => ({ prewarm: mocks.prewarm }))
vi.mock('../../configuration/claude-command.js', () => ({
  claudeCommand: async () => '/bin/claude',
}))

import { claudeAdapter, createClaudeAdapter } from './claude.js'

it('checks native goal support before sending the command and renders local output', async () => {
  const submitted: SDKUserMessage[] = []
  const commands = vi.fn<() => Promise<SlashCommand[]>>(async () => [
    { name: 'goal', description: 'Native goal', argumentHint: '', builtin: true },
  ])
  mocks.query.mockImplementation(({ prompt }) => ({
    supportedCommands: commands,
    async *[Symbol.asyncIterator]() {
      if (typeof prompt !== 'string') for await (const message of prompt) submitted.push(message)
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        local_command: 'goal',
        result: 'Goal active: Fix tests',
        session_id: 'session',
      }
    },
    close: vi.fn<() => void>(),
  }))
  const text = vi.fn<AgentRun['onText']>()
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
    cwd: '/tmp',
    prompt: 'user: /goal',
    goal: { action: 'get' },
    sessionId: 'session',
    signal: new AbortController().signal,
    onSession: () => {},
    onActivity: () => {},
    onText: text,
    approve: async () => 'deny',
    ask: async () => null,
  }
  await claudeAdapter.run(run)
  expect(commands).toHaveBeenCalledOnce()
  expect(submitted[0].message.content).toEqual([{ type: 'text', text: '/goal' }])
  expect(text).toHaveBeenCalledExactlyOnceWith('Goal active: Fix tests')
  submitted.length = 0
  commands.mockResolvedValue([])
  await expect(claudeAdapter.run(run)).rejects.toThrow('does not support native goals')
  expect(submitted).toHaveLength(0)
  await expect(claudeAdapter.run({ ...run, goal: { action: 'pause' } })).rejects.toThrow(
    'Claude supports',
  )
  expect(submitted).toHaveLength(0)
  mocks.query.mockReset()
})

it('reports a closed one-off Claude stream as a failure when the result is missing', async () => {
  mocks.query.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Partial output' },
        },
        session_id: 'session',
      }
    },
    close: vi.fn<() => void>(),
  }))
  const onText = vi.fn<AgentRun['onText']>()
  await expect(
    claudeAdapter.run({
      agent: {
        id: 'agent',
        name: 'Claude',
        provider: 'claude',
        permission: 'ask',
        endpoint: '',
        model: '',
        instructions: '',
      },
      cwd: '/tmp',
      prompt: 'Check the task',
      signal: new AbortController().signal,
      onSession: () => {},
      onActivity: () => {},
      onText,
      approve: async () => 'deny',
      ask: async () => null,
    }),
  ).rejects.toThrow('Claude connection ended before the result')
  expect(onText).toHaveBeenCalledExactlyOnceWith('Partial output')
})

it('keeps Claude proxy instances separate from local MCP and native tools', async () => {
  const observed: Options[] = []
  const mcpConfigs: unknown[] = []
  const paths: string[] = []
  mocks.query.mockClear()
  mocks.query.mockImplementation(({ options }) => {
    observed.push(options)
    const path = options.extraArgs?.['mcp-config']
    if (typeof path !== 'string') throw new Error('Expected a private MCP config path')
    paths.push(path)
    mcpConfigs.push(JSON.parse(readFileSync(path, 'utf8')))
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'proxy' }
      },
      close: vi.fn<() => void>(),
    }
  })
  const inheritedUrl = process.env.ANTHROPIC_BASE_URL
  const inheritedToken = process.env.ANTHROPIC_AUTH_TOKEN
  const run: AgentRun = {
    agent: {
      id: 'proxy-a',
      name: 'Claude proxy',
      provider: 'claude',
      endpoint: '',
      model: 'custom/claude-a',
      instructions: '',
      permission: 'ask',
      env: {
        ANTHROPIC_BASE_URL: 'http://proxy-a.lan:8317',
        ANTHROPIC_AUTH_TOKEN: 'fixture-proxy-a',
        ANTHROPIC_API_KEY: '',
        CLAUDE_CONFIG_DIR: '/tmp/claude-proxy-a',
        ENABLE_TOOL_SEARCH: 'false',
      },
      resources: decode(resourceSettingsSchema, {
        mcpServers: [taskToolsServer('proxy-thread', 1234, 'fixture-local', '127.0.0.1')],
      }),
    },
    cwd: '/tmp',
    prompt: 'Use code mode or a direct tool for this task',
    signal: new AbortController().signal,
    onSession: () => {},
    onActivity: () => {},
    onText: () => {},
    approve: async () => 'deny',
    ask: async () => null,
  }
  await claudeAdapter.run(run)
  await claudeAdapter.run({
    ...run,
    agent: {
      ...run.agent,
      id: 'proxy-b',
      model: 'custom/claude-b',
      env: {
        ...run.agent.env,
        ANTHROPIC_BASE_URL: 'http://proxy-b.lan:8317',
        ANTHROPIC_AUTH_TOKEN: 'fixture-proxy-b',
        CLAUDE_CONFIG_DIR: '/tmp/claude-proxy-b',
      },
    },
  })
  expect(observed).toHaveLength(2)
  expect(observed[0]).toMatchObject({
    model: 'custom/claude-a',
    pathToClaudeCodeExecutable: '/bin/claude',
    env: run.agent.env,
    settingSources: ['user', 'project', 'local'],
  })
  expect(observed[1]).toMatchObject({
    model: 'custom/claude-b',
    env: {
      ANTHROPIC_BASE_URL: 'http://proxy-b.lan:8317',
      ANTHROPIC_AUTH_TOKEN: 'fixture-proxy-b',
      ANTHROPIC_API_KEY: '',
      CLAUDE_CONFIG_DIR: '/tmp/claude-proxy-b',
    },
  })
  for (const options of observed) {
    expect(options.tools).toBeUndefined()
    expect(options.canUseTool).toBeTypeOf('function')
    expect(options.hooks?.PreToolUse).toBeDefined()
    expect(options.extraArgs).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
  }
  expect(mcpConfigs[0]).toEqual(mcpConfigs[1])
  expect(JSON.stringify(mcpConfigs)).toContain('fixture-local')
  expect(JSON.stringify(mcpConfigs)).not.toContain('fixture-proxy-')
  expect(paths.every((path) => !existsSync(path))).toBe(true)
  expect(process.env.ANTHROPIC_BASE_URL).toBe(inheritedUrl)
  expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe(inheritedToken)
  mocks.query.mockReset()
})

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
    approve: async () => 'deny' as const,
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
    isolateSettings: true,
    agent: { ...run.agent, permission: 'read-only' },
  })
  expect(mocks.query).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        settingSources: [],
        tools: ['Read', 'Glob', 'Grep', 'ToolSearch', 'AskUserQuestion'],
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
    agent: {
      ...run.agent,
      args: [
        '--settings={"env":{"ANTHROPIC_BASE_URL":"http://gateway","ANTHROPIC_AUTH_TOKEN":"fixture-token","UNRELATED_SECRET":"private"},"hooks":{}}',
        '--setting-sources=',
        '--managed-settings={"env":{"ANTHROPIC_BASE_URL":"http://ignored-managed"},"permissions":{"deny":["Read"]}}',
      ],
    },
  })
  expect(mocks.query).toHaveBeenCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        settingSources: [],
        env: expect.objectContaining({
          ANTHROPIC_BASE_URL: 'http://gateway',
          ANTHROPIC_AUTH_TOKEN: 'fixture-token',
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
        }),
        extraArgs: expect.not.objectContaining({ settings: expect.anything() }),
        tools: [],
        strictMcpConfig: true,
        mcpServers: {},
      }),
    }),
  )
  expect(mocks.query.mock.calls[0][0].options.env?.UNRELATED_SECRET).toBeUndefined()
  expect(mocks.query.mock.calls[0][0].options.extraArgs).not.toHaveProperty('setting-sources')
  expect(mocks.query.mock.calls[0][0].options.extraArgs).not.toHaveProperty('managed-settings')
})
it('requests native JSON output and delivers the canonical result separately from streamed prose', async () => {
  mocks.query.mockClear()
  const result = { status: 'selected', repositoryId: 'shop', links: [], reason: 'Cart owner' }
  mocks.query.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'I inspected the shopping code.' },
        },
      }
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: result,
        session_id: 'utility',
      }
    },
    close: vi.fn<() => void>(),
  }))
  const output: string[] = []
  const outputSchema = {
    type: 'object',
    properties: { repositoryId: { type: 'string' } },
    required: ['repositoryId'],
    additionalProperties: false,
  }
  const adapter = createClaudeAdapter()
  try {
    await adapter.run({
      agent: {
        id: 'utility',
        name: 'Utility',
        provider: 'claude',
        endpoint: '',
        model: '',
        instructions: 'Select a project',
        permission: 'read-only',
      },
      ephemeral: true,
      outputSchema,
      cwd: '/tmp',
      prompt: 'Fix cart totals',
      signal: new AbortController().signal,
      onSession: () => {},
      onText: (text) => output.push(text),
      onTextBoundary: () => output.push('boundary'),
      onActivity: () => {},
      approve: async () => 'deny',
      ask: async () => null,
    })
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          outputFormat: { type: 'json_schema', schema: outputSchema },
        }),
      }),
    )
    expect(output).toEqual(['I inspected the shopping code.', 'boundary', JSON.stringify(result)])
  } finally {
    await adapter.dispose?.()
  }
})

it('keeps a streaming Claude connection across turns', async () => {
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  mocks.query.mockClear()
  const prompts: string[] = []
  const output: string[] = []
  const events: string[] = []
  const startup = vi.fn<NonNullable<AgentRun['onStartup']>>()
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
            : content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''),
        )
        if (prompts.length === 1) yield { type: 'system', subtype: 'init', session_id: 'session' }
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
    onStartup: startup,
    onText: (text) => output.push(text),
    onTextBoundary: () => output.push('boundary'),
    onActivity: () => {},
    onEvent: (name) => events.push(name),
    approve: async () => 'deny' as const,
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
    expect(startup.mock.calls).toEqual([['opening-session'], ['sending-prompt']])
    startup.mockClear()
    const launched = mocks.query.mock.calls.at(-1)?.[0].options
    expect(launched?.mcpServers).toBeUndefined()
    const configPath = launched?.extraArgs?.['mcp-config']
    if (typeof configPath !== 'string') throw new Error('Expected a private MCP config path')
    expect(readFileSync(configPath, 'utf8')).toContain('DOVO_TASK_TOKEN')
    expect(JSON.stringify(launched?.extraArgs)).not.toContain('token')

    // A completed reply must not wait for optional metadata or receive it late.
    resolveAccount({ subscriptionType: 'test' })
    await metadata
    expect(events).not.toContain('account/info')
    await claudeAdapter.run({ ...boundRun('second-run'), sessionId: 'session', prompt: 'second' })
    expect(startup.mock.calls).toEqual([['connecting-tools'], ['sending-prompt']])
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
    expect(existsSync(configPath)).toBe(false)
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
    approve: async () => 'deny' as const,
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

it.each([
  ['task_started', 'local_agent'],
  ['background_tasks_changed', 'local_agent'],
  ['task_started', 'local_bash'],
  ['background_tasks_changed', 'local_bash'],
] as const)(
  'keeps native Claude work alive under memory pressure after %s and releases the finished session',
  async (subtype, taskType) => {
    const adapter = createClaudeAdapter()
    const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(true)
    let finishChild = () => {}
    const childFinished = new Promise<void>((resolve) => {
      finishChild = resolve
    })
    const close = vi.fn<() => void>(finishChild)
    mocks.query.mockImplementation(({ prompt }) => ({
      async *[Symbol.asyncIterator]() {
        if (typeof prompt === 'string') throw new Error('Expected streaming input')
        let first = true
        for await (const _message of prompt) {
          if (first) {
            yield {
              type: 'system',
              subtype,
              session_id: 'session',
              task_id: 'native-child',
              task_type: taskType,
              is_backgrounded: true,
              description: 'Explore',
              tasks: [{ task_id: 'native-child', task_type: taskType, description: 'Explore' }],
            }
          }
          yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
          if (first) {
            first = false
            await childFinished
            yield {
              type: 'assistant',
              uuid: 'late-reply',
              session_id: 'session',
              parent_tool_use_id: null,
              message: { content: [{ type: 'text', text: 'Background work finished' }] },
            }
            yield {
              type: 'system',
              subtype: 'task_notification',
              task_id: 'native-child',
              status: 'completed',
              session_id: 'session',
            }
            // The woken root agent ends its reply with a result, like every Claude turn.
            yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
          }
        }
      },
      close,
    }))
    const native = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
    const run = nativeRun(native)
    try {
      await adapter.run(run)
      expect(close).not.toHaveBeenCalled()
      expect(native).not.toHaveBeenCalledWith('dovo/session/closed', {}, 'session')
      finishChild()
      await vi.waitFor(() =>
        expect(native).toHaveBeenCalledWith(
          'system',
          expect.objectContaining({ subtype: 'task_notification', status: 'completed' }),
          'session',
        ),
      )
      expect(native).toHaveBeenCalledWith(
        'dovo/session/message',
        { id: 'late-reply', text: 'Background work finished' },
        'session',
      )
      await adapter.run({ ...run, sessionId: 'session', prompt: 'Second' })
      expect(close).toHaveBeenCalled()
      expect(native).toHaveBeenCalledWith('dovo/session/closed', {}, 'session')
    } finally {
      finishChild()
      await adapter.dispose?.()
      pressure.mockRestore()
    }
  },
)

function nativeRun(onSubagentEvent: AgentRun['onSubagentEvent']): AgentRun {
  return {
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
    onSubagentEvent,
    approve: vi.fn<AgentRun['approve']>(async () => 'deny' as const),
    ask: vi.fn<AgentRun['ask']>(async () => null),
  }
}
it('releases a completed child transport while retaining its resumable session ID', async () => {
  const adapter = createClaudeAdapter()
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  const close = vi.fn<() => void>()
  mocks.query.mockImplementation(({ prompt }) => ({
    async *[Symbol.asyncIterator]() {
      if (typeof prompt === 'string') throw new Error('Expected streaming input')
      for await (const _message of prompt)
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
    },
    close,
  }))
  const run = nativeRun(vi.fn())
  try {
    await adapter.run(run)
    expect(close).not.toHaveBeenCalled()
    await adapter.releaseTask?.('native-claude')
    expect(close).toHaveBeenCalledOnce()
    await adapter.run({ ...run, prompt: 'Follow-up', sessionId: 'session' })
    expect(mocks.query.mock.calls.at(-1)?.[0].options.resume).toBe('session')
  } finally {
    await adapter.dispose?.()
    pressure.mockRestore()
  }
})

it('routes only live native-agent approvals and questions through the session after a reply', async () => {
  const adapter = createClaudeAdapter()
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  let finishChild = () => {}
  const childFinished = new Promise<void>((resolve) => {
    finishChild = resolve
  })
  let options: Options | undefined
  mocks.query.mockImplementation(({ prompt, options: current }) => {
    options = current
    return {
      async *[Symbol.asyncIterator]() {
        if (typeof prompt === 'string') throw new Error('Expected streaming input')
        for await (const _message of prompt) {
          yield {
            type: 'system',
            subtype: 'task_started',
            task_id: 'native-child',
            task_type: 'local_agent',
            description: 'Explore',
            session_id: 'session',
          }
          yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
          await childFinished
          yield {
            type: 'system',
            subtype: 'task_notification',
            task_id: 'native-child',
            status: 'completed',
            session_id: 'session',
          }
        }
      },
      close: finishChild,
    }
  })
  const native = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  const run = nativeRun(native)
  const approve = vi.fn<NonNullable<AgentRun['nativeAgentInteractions']>['approve']>(
    async () => 'approve' as const,
  )
  const ask = vi.fn<AgentRun['ask']>(async () => ({ '0': ['Small change'] }))
  run.nativeAgentInteractions = { active: () => true, approve, ask }
  const controller = new AbortController()
  const request = {
    signal: controller.signal,
    agentID: 'native-child',
    toolUseID: 'tool',
    requestId: 'request',
  }
  try {
    await adapter.run(run)
    if (!options?.canUseTool) throw new Error('Expected a permission handler')
    await expect(options.canUseTool('Bash', { command: 'pwd' }, request)).resolves.toMatchObject({
      behavior: 'allow',
    })
    expect(approve).toHaveBeenCalledWith(
      'Bash',
      expect.stringContaining('pwd'),
      expect.any(AbortSignal),
      'command',
      undefined,
    )
    await expect(
      options.canUseTool(
        'AskUserQuestion',
        {
          questions: [
            {
              question: 'How should we proceed?',
              header: 'Direction',
              options: [{ label: 'Small change', description: 'Focused' }],
            },
          ],
        },
        request,
      ),
    ).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'How should we proceed?': 'Small change' } },
    })
    expect(ask).toHaveBeenCalledOnce()
    await expect(
      options.canUseTool('Bash', {}, { ...request, agentID: 'unknown' }),
    ).resolves.toMatchObject({ behavior: 'deny' })
    expect(run.approve).not.toHaveBeenCalled()
    expect(run.ask).not.toHaveBeenCalled()
    finishChild()
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith(
        'system',
        expect.objectContaining({ subtype: 'task_notification' }),
        'session',
      ),
    )
    await expect(options.canUseTool('Bash', {}, request)).resolves.toMatchObject({
      behavior: 'deny',
    })
    expect(approve).toHaveBeenCalledOnce()
    // The finished child wakes the root agent. Its approval uses the session channel too.
    await expect(
      options.canUseTool('Bash', { command: 'git status' }, { ...request, agentID: undefined }),
    ).resolves.toMatchObject({ behavior: 'allow' })
    expect(approve).toHaveBeenCalledTimes(2)
    expect(run.approve).not.toHaveBeenCalled()
  } finally {
    finishChild()
    await adapter.dispose?.()
    pressure.mockRestore()
  }
})

const denied = { hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) }
it.each([
  ['full-access', true, {}],
  ['read-only', true, denied],
  // The thread lowered its access or reset its session after the turn that set this policy.
  ['full-access', false, denied],
] as const)(
  'applies the %s owner policy to root tools after a background task wakes the session (current: %s)',
  async (permission, current, expected) => {
    const adapter = createClaudeAdapter()
    const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
    let finish = () => {}
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    let options: Options | undefined
    mocks.query.mockImplementation(({ prompt, options: current }) => {
      options = current
      return {
        async *[Symbol.asyncIterator]() {
          if (typeof prompt === 'string') throw new Error('Expected streaming input')
          for await (const _message of prompt) {
            yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
            await finished
          }
        },
        close: finish,
      }
    })
    const run = nativeRun(vi.fn<NonNullable<AgentRun['onSubagentEvent']>>())
    run.agent = { ...run.agent, permission }
    run.nativeAgentInteractions = {
      active: () => current,
      approve: vi.fn<NonNullable<AgentRun['nativeAgentInteractions']>['approve']>(
        async () => 'approve' as const,
      ),
      ask: vi.fn<AgentRun['ask']>(async () => null),
    }
    try {
      await adapter.run(run)
      const hook = options?.hooks?.PreToolUse?.[0].hooks[0]
      if (!hook) throw new Error('Expected a pre-use hook')
      // No Dovo turn is active: Claude's root agent is answering a task notification.
      const result = await hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'git status' },
          tool_use_id: 'tool',
          session_id: 'session',
          transcript_path: '/tmp/transcript',
          cwd: '/tmp',
        },
        'tool',
        { signal: new AbortController().signal },
      )
      expect(result).toEqual(expected)
      if (!options?.canUseTool) throw new Error('Expected a permission handler')
      const request = { signal: new AbortController().signal, toolUseID: 'tool', requestId: 'r' }
      await expect(options.canUseTool('Edit', {}, request)).resolves.toMatchObject({
        behavior: permission === 'full-access' && current ? 'allow' : 'deny',
      })
    } finally {
      finish()
      await adapter.dispose?.()
      pressure.mockRestore()
    }
  },
)

function gate() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}
function wakeFixture() {
  const gates = { wake: gate(), result: gate(), closed: gate() }
  let interrupted = false
  const submitted: SDKUserMessage[] = []
  const interrupt = vi.fn<() => Promise<void>>(async () => {
    interrupted = true
    gates.result.resolve()
  })
  mocks.query.mockImplementation(({ prompt }) => ({
    async *[Symbol.asyncIterator]() {
      if (typeof prompt === 'string') throw new Error('Expected streaming input')
      for await (const message of prompt) {
        submitted.push(message)
        if (submitted.length > 1) {
          yield {
            type: 'stream_event',
            session_id: 'session',
            parent_tool_use_id: null,
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Second reply' },
            },
          }
          yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
          continue
        }
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
        // A background job finishes after the turn. Its notification wakes the root agent.
        await gates.wake.promise
        yield {
          type: 'stream_event',
          session_id: 'session',
          parent_tool_use_id: null,
          event: { type: 'message_start' },
        }
        yield {
          type: 'assistant',
          uuid: 'wake-reply',
          session_id: 'session',
          parent_tool_use_id: null,
          message: {
            content: [
              { type: 'text', text: 'The build passed. Checking the output.' },
              { type: 'tool_use', id: 'wake-tool', name: 'Bash', input: { command: 'ls' } },
            ],
          },
        }
        await Promise.race([gates.result.promise, gates.closed.promise])
        yield interrupted
          ? {
              type: 'result',
              subtype: 'success',
              is_error: false,
              terminal_reason: 'aborted_streaming',
              session_id: 'session',
            }
          : { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
      }
    },
    interrupt,
    stopTask: vi.fn<(id: string) => Promise<void>>(async () => {}),
    close: () => gates.closed.resolve(),
  }))
  return { gates, submitted, interrupt }
}
const rootEvent = (subtype: string, fields: Record<string, unknown> = {}) =>
  expect.objectContaining({ type: 'system', subtype, task_id: 'session', ...fields })

it('makes a new turn wait for a woken root agent and keeps the wake result out of it', async () => {
  const adapter = createClaudeAdapter()
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  const { gates, submitted } = wakeFixture()
  const native = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  const run = nativeRun(native)
  try {
    await adapter.run(run)
    gates.wake.resolve()
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith('system', rootEvent('task_started'), 'session'),
    )
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith(
        'system',
        rootEvent('task_progress', { last_tool_name: 'Bash' }),
        'session',
      ),
    )
    const rebound = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
    const text = vi.fn<AgentRun['onText']>()
    const activity = vi.fn<AgentRun['onActivity']>()
    let settled = false
    const second = adapter
      .run({
        ...run,
        sessionId: 'session',
        prompt: 'Second',
        onText: text,
        onActivity: activity,
        onSubagentEvent: rebound,
      })
      .finally(() => (settled = true))
    await vi.waitFor(() => expect(activity).toHaveBeenCalledWith(expect.stringContaining('Wait')))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    expect(submitted).toHaveLength(1)
    gates.result.resolve()
    await second
    // The new turn ends on its own result, and the wake's completion reaches its callbacks.
    expect(submitted).toHaveLength(2)
    expect(text).toHaveBeenCalledWith('Second reply')
    expect(rebound).toHaveBeenCalledWith(
      'system',
      rootEvent('task_notification', { status: 'completed' }),
      'session',
    )
  } finally {
    gates.result.resolve()
    await adapter.dispose?.()
    pressure.mockRestore()
  }
})

it('lets Stop interrupt a woken root agent and report it stopped', async () => {
  const adapter = createClaudeAdapter()
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  const { gates, interrupt } = wakeFixture()
  const native = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  let control: NativeAgentSession | undefined
  const run = {
    ...nativeRun(native),
    onNativeSession: (session: NativeAgentSession) => (control = session),
  }
  try {
    await adapter.run(run)
    gates.wake.resolve()
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith('system', rootEvent('task_started'), 'session'),
    )
    if (!control) throw new Error('Expected a native session')
    await control.stop()
    expect(interrupt).toHaveBeenCalledOnce()
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith(
        'system',
        rootEvent('task_notification', { status: 'stopped' }),
        'session',
      ),
    )
  } finally {
    gates.result.resolve()
    await adapter.dispose?.()
    pressure.mockRestore()
  }
})

it('publishes successful main-thread todo hooks and excludes child hooks', async () => {
  mocks.query.mockImplementation(({ options }) => ({
    async *[Symbol.asyncIterator]() {
      const hook = options.hooks?.PostToolUse?.[0].hooks[0]
      if (!hook) throw new Error('Expected checklist hook')
      const input = {
        hook_event_name: 'PostToolUse' as const,
        session_id: 'session',
        transcript_path: '/fixture/transcript',
        cwd: '/tmp',
        tool_name: 'TodoWrite',
        tool_use_id: 'todo',
        tool_input: { todos: [] },
        tool_response: { newTodos: [] },
      }
      await hook({ ...input, agent_id: 'child' }, 'todo', { signal: new AbortController().signal })
      await hook(input, 'todo', { signal: new AbortController().signal })
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
    },
    close: vi.fn<() => void>(),
  }))
  const events = vi.fn<NonNullable<AgentRun['onEvent']>>()
  const adapter = createClaudeAdapter()
  try {
    await adapter.run({
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
      prompt: 'Track work',
      signal: new AbortController().signal,
      onSession: () => {},
      onText: () => {},
      onActivity: () => {},
      onEvent: events,
      approve: async () => 'deny',
      ask: async () => null,
    })
    expect(events.mock.calls.filter(([name]) => name === 'claude/checklist')).toEqual([
      [
        'claude/checklist',
        expect.objectContaining({ tool_name: 'TodoWrite', tool_response: { newTodos: [] } }),
      ],
    ])
  } finally {
    await adapter.dispose?.()
  }
})

it.each([true, false])(
  'allows only configured conversation/progress and skill-read tools in a read-only Claude run (managed=%s)',
  async (managed) => {
    const adapter = createClaudeAdapter()
    const decisions: string[] = []
    mocks.query.mockImplementation(({ prompt, options }) => ({
      async *[Symbol.asyncIterator]() {
        if (typeof prompt === 'string' || !options.canUseTool)
          throw new Error('Expected a managed stream')
        for await (const _message of prompt) {
          for (const name of [
            'mcp__dovo_task__ask_question',
            'mcp__dovo_task__a2ui',
            'mcp__dovo_task__todos',
            'mcp__dovo_task__skill_read',
            'mcp__other__todos',
            'mcp__dovo_task__linked_projects',
          ]) {
            const decision = await options.canUseTool(
              name,
              {},
              { signal: new AbortController().signal, toolUseID: 'tool', requestId: 'request' },
            )
            decisions.push(decision?.behavior ?? 'cancelled')
          }
          yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
        }
      },
      close: () => {},
    }))
    const run = nativeRun(vi.fn())
    run.agent.permission = 'read-only'
    run.agent.resources = decode(resourceSettingsSchema, {
      mcpServers: managed ? [taskToolsServer(run.taskId!, 1234, 'token', '127.0.0.1', true)] : [],
    })
    try {
      await adapter.run(run)
      expect(decisions).toEqual([
        managed ? 'allow' : 'deny',
        managed ? 'allow' : 'deny',
        managed ? 'allow' : 'deny',
        managed ? 'allow' : 'deny',
        'deny',
        'deny',
      ])
      expect(run.approve).not.toHaveBeenCalled()
    } finally {
      await adapter.dispose?.()
    }
  },
)

it.each([
  'success',
  'refused',
  'option_not_applied',
  'different-environment',
  'cancelled',
] as const)('handles a prewarmed new thread with %s without duplicate prompts', async (mode) => {
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  const adapter = createClaudeAdapter()
  const delivered: string[] = []
  const order: string[] = []
  let resolveExit = () => {}
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  const streamFor = (prompt: string | AsyncIterable<SDKUserMessage>) => ({
    async *[Symbol.asyncIterator]() {
      if (typeof prompt === 'string') throw new Error('Expected queued input')
      for await (const message of prompt) {
        order.push('prompt')
        delivered.push(
          typeof message.message.content === 'string'
            ? message.message.content
            : message.message.content
                .flatMap((block) => (block.type === 'text' ? [block.text] : []))
                .join(''),
        )
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
      }
    },
    setMcpServers: vi.fn<() => Promise<{ errors: Record<string, string> }>>(async () => {
      order.push('tools')
      return { errors: {} }
    }),
    close: vi.fn<() => void>(),
  })
  const controller = new AbortController()
  const claim = vi.fn<
    (input: {
      prompt: string | AsyncIterable<SDKUserMessage>
      options?: unknown
    }) => ReturnType<typeof streamFor>
  >(({ prompt }) => {
    if (mode === 'cancelled') controller.abort(new Error('Stopped'))
    if (mode === 'refused' || mode === 'option_not_applied' || mode === 'cancelled')
      throw new Error(mode + ': fixture')
    return streamFor(prompt)
  })
  const close = vi.fn<() => void>(resolveExit)
  mocks.prewarm.mockResolvedValueOnce({
    claim,
    claimed: Promise.resolve({ cwd: '/tmp', sessionId: 'session', sdkMcpSettled: true }),
    exited,
    close,
  })
  mocks.query.mockClear().mockImplementation(({ prompt }) => streamFor(prompt))
  try {
    const first = nativeRun(vi.fn())
    await adapter.run(first)
    await vi.waitFor(() => expect(mocks.prewarm).toHaveBeenCalled())
    // Let prewarm install its resolved spare before starting another task.
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    const second = {
      ...first,
      taskId: 'second-thread',
      prompt: 'Second',
      signal: controller.signal,
      ...(mode === 'different-environment'
        ? { agent: { ...first.agent, env: { CLAUDE_CONFIG_DIR: '/different/config' } } }
        : {}),
    }
    const rejection = await adapter.run(second).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    const rejected = mode === 'cancelled' || mode === 'option_not_applied'
    expect(rejection).toBe(
      mode === 'cancelled'
        ? 'Stopped'
        : mode === 'option_not_applied'
          ? 'option_not_applied: fixture'
          : undefined,
    )
    expect(claim).toHaveBeenCalledTimes(mode === 'different-environment' ? 0 : 1)
    expect(mocks.query).toHaveBeenCalledTimes(mode === 'success' || rejected ? 1 : 2)
    expect(delivered).toEqual(rejected ? ['First'] : ['First', 'Second'])
    expect(order).toEqual(
      mode === 'success'
        ? ['prompt', 'tools', 'prompt']
        : rejected
          ? ['prompt']
          : ['prompt', 'prompt'],
    )
    const expectedOptions = expect.objectContaining({ cwd: '/tmp', permissionMode: 'default' })
    expect(claim.mock.calls.map(([input]) => input.options)).toEqual(
      mode === 'different-environment' ? [] : [expectedOptions],
    )
  } finally {
    await adapter.dispose?.()
    close()
    pressure.mockRestore()
  }
})

it('closes a tool approval that Claude withdraws while the turn stays active', async () => {
  const { Approvals } = await import('../../execution/approvals.js')
  const adapter = createClaudeAdapter()
  const approvals = new Approvals()
  const request = new AbortController()
  const observed: { listed: number; afterWithdraw: number; activeTurn: boolean } = {
    listed: 0,
    afterWithdraw: -1,
    activeTurn: false,
  }
  let decision: string | undefined
  let retry: string | undefined
  const run = nativeRun(vi.fn())
  // Same wiring as the active turn: the turn signal plus the provider request signal.
  run.approve = (title, detail, kind, options, signal) =>
    approvals.request(
      'native-claude',
      title,
      detail,
      signal ? AbortSignal.any([run.signal, signal]) : run.signal,
      kind,
      options,
    )
  mocks.query.mockImplementation(({ prompt, options }) => ({
    async *[Symbol.asyncIterator]() {
      if (typeof prompt === 'string' || !options.canUseTool)
        throw new Error('Expected a managed stream')
      for await (const _message of prompt) {
        const pending = options.canUseTool(
          'Bash',
          { command: 'echo harmless' },
          { signal: request.signal, toolUseID: 'tool', requestId: 'request' },
        )
        await vi.waitFor(() => expect(approvals.list()).toHaveLength(1))
        observed.listed = approvals.list().length
        const [{ id }] = approvals.list()
        request.abort()
        decision = (await pending)?.behavior
        observed.afterWithdraw = approvals.list().length
        observed.activeTurn = !run.signal.aborted
        try {
          approvals.decide(id, 'always')
        } catch (error) {
          retry = error instanceof Error ? error.message : String(error)
        }
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'session' }
      }
    },
    close: () => {},
  }))
  try {
    await adapter.run(run)
    expect(observed).toEqual({ listed: 1, afterWithdraw: 0, activeTurn: true })
    expect(decision).toBe('deny')
    expect(retry).toBe('This approval request was withdrawn, or its turn ended.')
  } finally {
    await adapter.dispose?.()
  }
})
