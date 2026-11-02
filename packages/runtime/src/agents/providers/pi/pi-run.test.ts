import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { decode, agentSchema } from '@dovo/protocol'
import type { AgentRun } from '../../execution/types.js'
import { runPiSession } from './pi-run.js'

const mocks = vi.hoisted(() => ({
  requests: vi.fn<(command: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
  close: vi.fn<() => Promise<void>>(),
  args: [] as string[],
  listener: undefined as ((event: Record<string, unknown>) => void) | undefined,
}))
vi.mock('./pi-version.js', () => ({ requirePiVersion: async () => {} }))
vi.mock('./rpc.js', () => ({
  PiRpc: class {
    constructor(_command: string, args: string[]) {
      mocks.args = args
    }
    request(command: Record<string, unknown>) {
      return mocks.requests(command)
    }
    onEvent(listener: (event: Record<string, unknown>) => void) {
      mocks.listener = listener
      return () => {}
    }
    onFailure() {
      return () => {}
    }
    close() {
      return mocks.close()
    }
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.close.mockResolvedValue(undefined)
  mocks.requests.mockImplementation(async (command) => {
    if (command.type === 'switch_session') return { data: { cancelled: false } }
    if (command.type === 'get_state') return { data: { sessionFile: '/session.jsonl' } }
    if (command.type === 'prompt') {
      mocks.listener?.({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      })
      mocks.listener?.({ type: 'agent_settled', aborted: false })
      return { data: { disposition: 'started' } }
    }
    return {}
  })
})
function run(): AgentRun {
  return {
    agent: decode(agentSchema, {
      id: 'pi',
      name: 'Pi',
      provider: 'pi',
      model: '',
      instructions: '',
      permission: 'ask',
      endpoint: '',
    }),
    cwd: '/project',
    sessionId: '/session.jsonl',
    prompt: 'Continue',
    signal: new AbortController().signal,
    onSession: vi.fn<AgentRun['onSession']>(),
    onText: vi.fn<AgentRun['onText']>(),
    onActivity: vi.fn<AgentRun['onActivity']>(),
    approve: vi.fn<AgentRun['approve']>(),
    ask: vi.fn<AgentRun['ask']>(),
  }
}
it('switches to the imported file before sending and streams the response', async () => {
  const input = run()
  await runPiSession(input)
  expect(mocks.requests.mock.calls.map(([command]) => command.type)).toEqual([
    'switch_session',
    'get_state',
    'prompt',
  ])
  expect(input.onSession).toHaveBeenCalledWith('/session.jsonl')
  expect(input.onText).toHaveBeenCalledWith('Hello')
  expect(mocks.args).toEqual(
    expect.arrayContaining([
      '--no-tools',
      '--no-extensions',
      '--no-mcp',
      '--no-skills',
      '--no-prompt-templates',
    ]),
  )
  expect(mocks.close).toHaveBeenCalledOnce()
})
it('enables only Pi built-in tools for explicit unrestricted full access', async () => {
  const input = run()
  input.agent.permission = 'full-access'
  await runPiSession(input)
  expect(mocks.args).toEqual(
    expect.arrayContaining([
      '--tools',
      'read,bash,edit,write',
      '--no-extensions',
      '--no-mcp',
      '--no-skills',
      '--no-prompt-templates',
    ]),
  )
  expect(mocks.args).not.toContain('--no-tools')
  input.agent.approvalPolicy = 'never'
  await runPiSession(input)
  expect(mocks.args).toEqual(expect.arrayContaining(['--tools', 'read,bash,edit,write']))
})
it('applies and verifies the selected model and thinking level after switching sessions', async () => {
  let selected = false
  mocks.requests.mockImplementation(async (command) => {
    if (command.type === 'switch_session') return { data: { cancelled: false } }
    if (command.type === 'get_state')
      return {
        data: {
          sessionFile: '/session.jsonl',
          ...(selected
            ? { model: { provider: 'fixture', id: 'model' }, thinkingLevel: 'high' }
            : {}),
        },
      }
    if (command.type === 'get_available_models')
      return { data: { models: [{ provider: 'fixture', id: 'model' }] } }
    if (command.type === 'get_available_thinking_levels')
      return { data: { levels: ['off', 'high'] } }
    if (command.type === 'set_thinking_level') selected = true
    if (command.type === 'prompt') {
      mocks.listener?.({ type: 'agent_settled', aborted: false })
      return { data: { disposition: 'started' } }
    }
    return {}
  })
  const input = run()
  input.agent.model = 'fixture/model'
  input.agent.reasoning = 'high'
  await runPiSession(input)
  expect(mocks.requests.mock.calls.map(([command]) => command.type)).toEqual([
    'switch_session',
    'get_state',
    'get_available_models',
    'set_model',
    'get_available_thinking_levels',
    'set_thinking_level',
    'get_state',
    'prompt',
  ])
  expect(mocks.requests).toHaveBeenCalledWith({
    type: 'set_model',
    provider: 'fixture',
    modelId: 'model',
  })
  expect(mocks.requests).toHaveBeenCalledWith({ type: 'set_thinking_level', level: 'high' })
})
it('rejects an unavailable selected model instead of silently using the session model', async () => {
  const input = run()
  input.agent.model = 'missing'
  await expect(runPiSession(input)).rejects.toThrow('Pi model not found')
  expect(mocks.requests.mock.calls.some(([command]) => command.type === 'prompt')).toBe(false)
})
it('rejects an unsupported thinking level before prompting', async () => {
  const input = run()
  input.agent.reasoning = 'high'
  await expect(runPiSession(input)).rejects.toThrow('Pi thinking level is not available')
  expect(mocks.requests.mock.calls.some(([command]) => command.type === 'prompt')).toBe(false)
})
it.each([
  ['supervised', { permission: 'ask' as const }],
  ['auto', { permission: 'auto' as const }],
  [
    'approval required',
    { permission: 'full-access' as const, approvalPolicy: 'on-request' as const },
  ],
  [
    'restricted sandbox',
    { permission: 'full-access' as const, sandboxMode: 'workspace-write' as const },
  ],
  ['read-only sandbox', { permission: 'full-access' as const, sandboxMode: 'read-only' as const }],
])('keeps tools disabled under %s', async (_name, overrides) => {
  const input = run()
  input.agent = { ...input.agent, ...overrides }
  await runPiSession(input)
  expect(mocks.args).toContain('--no-tools')
  expect(mocks.args).not.toContain('--tools')
})
it('keeps tools disabled for text-only runs and read-only linked checkouts', async () => {
  const input = run()
  input.agent.permission = 'full-access'
  input.tools = 'none'
  await runPiSession(input)
  expect(mocks.args).toContain('--no-tools')
  input.tools = undefined
  input.linkedDirectories = [{ id: 'linked', path: '/read-only', access: 'read-only' }]
  await runPiSession(input)
  expect(mocks.args).toContain('--no-tools')
})
it('waits for retry completion before deciding whether an assistant error is final', async () => {
  mocks.requests.mockImplementation(async (command) => {
    if (command.type === 'switch_session') return { data: { cancelled: false } }
    if (command.type === 'get_state') return { data: { sessionFile: '/session.jsonl' } }
    if (command.type === 'prompt') {
      mocks.listener?.({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'temporary error' },
      })
      mocks.listener?.({ type: 'auto_retry_start' })
      mocks.listener?.({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } })
      mocks.listener?.({ type: 'agent_settled', aborted: false })
      return { data: { disposition: 'started' } }
    }
    return {}
  })
  await expect(runPiSession(run())).resolves.toBeUndefined()
})
it('reports an assistant error when the turn settles without recovery', async () => {
  mocks.requests.mockImplementation(async (command) => {
    if (command.type === 'switch_session') return { data: { cancelled: false } }
    if (command.type === 'get_state') return { data: { sessionFile: '/session.jsonl' } }
    if (command.type === 'prompt') {
      mocks.listener?.({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'final error' },
      })
      mocks.listener?.({ type: 'agent_settled', aborted: false })
      return { data: { disposition: 'started' } }
    }
    return {}
  })
  await expect(runPiSession(run())).rejects.toThrow('final error')
})
it('refuses continuation if the selected private file was not loaded', async () => {
  mocks.requests.mockResolvedValue({ data: { sessionFile: '/other' } })
  await expect(runPiSession(run())).rejects.toThrow('did not open')
  expect(mocks.requests.mock.calls.map(([command]) => command.type)).toEqual([
    'switch_session',
    'get_state',
  ])
})
