import process from 'node:process'
import { expect, it, vi } from 'vite-plus/test'
import {
  defaultTaskHarness,
  decode,
  agentHookSchema,
  mergeResources,
  type AgentHook,
} from '@dovo/protocol'
import { runWithHooks, type HookResult } from './agent-hooks.js'
import type { AgentRun } from './types.js'

const echoContext = `node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(s))'`
const hook = (event: AgentHook['event'], extra: Partial<AgentHook> = {}): AgentHook => ({
  name: event,
  event,
  enabled: true,
  command: echoContext,
  timeoutSeconds: 5,
  ...extra,
})
function fixture(overrides: Partial<AgentRun> = {}) {
  const run: AgentRun = {
    agent: {
      ...defaultTaskHarness('codex'),
      id: 'agent',
      name: 'Agent',
      permission: 'full-access',
    },
    taskId: 'task',
    cwd: process.cwd(),
    prompt: 'Hello',
    signal: new AbortController().signal,
    onSession: vi.fn<AgentRun['onSession']>(),
    onText: vi.fn<AgentRun['onText']>(),
    onActivity: vi.fn<AgentRun['onActivity']>(),
    onEvent: vi.fn<NonNullable<AgentRun['onEvent']>>(),
    approve: vi.fn<AgentRun['approve']>(async () => 'approve' as const),
    ask: vi.fn<AgentRun['ask']>(async () => null),
    ...overrides,
  }
  const report = vi.fn<(result: HookResult) => void>()
  const repair = vi.fn<() => void>()
  return { run, report, repair }
}
it('sends ordered JSON context across shared boundaries and drains observations before after-turn', async () => {
  const { run, report, repair } = fixture()
  const runAdapter = vi.fn<(input: AgentRun) => Promise<void>>(async (input: AgentRun) => {
    input.onSession('session')
    input.onEvent?.('item/started', {
      item: { id: 'tool', type: 'commandExecution', command: 'pwd' },
    })
    input.onEvent?.('item/started', {
      item: { id: 'tool', type: 'commandExecution', command: 'pwd' },
    })
    expect(await input.approve('Run shell', 'pwd')).toBe('approve')
    input.onEvent?.('item/completed', {
      item: {
        id: 'tool',
        type: 'commandExecution',
        status: 'completed',
        aggregatedOutput: '/work',
      },
    })
  })
  const events = [
    'before-turn',
    'session-start',
    'tool-start',
    'permission-request',
    'permission-response',
    'tool-complete',
    'after-turn',
  ] as const
  await runWithHooks(
    { run: runAdapter },
    run,
    events.map((event) => hook(event)),
    report,
    repair,
  )
  const contexts = report.mock.calls.map(([result]) => JSON.parse(result.output))
  expect(contexts.map((value) => value.event)).toEqual(events)
  expect(contexts[0]).toMatchObject({
    version: 1,
    taskId: 'task',
    harness: 'codex',
    cwd: run.cwd,
    prompt: 'Hello',
  })
  expect(contexts[1]).toMatchObject({ sessionId: 'session', resumed: false })
  expect(contexts[5]).toMatchObject({
    tool: { name: 'commandExecution', kind: 'command', input: 'pwd', output: '/work' },
  })
  expect(run.onEvent).toHaveBeenCalledTimes(3)
  expect(run.approve).toHaveBeenCalledOnce()
  expect(repair).not.toHaveBeenCalled()
})
it('denies permission when a matching hook fails, without opening approval UI', async () => {
  const { run, report, repair } = fixture()
  await runWithHooks(
    {
      run: async (input) => {
        expect(await input.approve('Dangerous shell', 'rm file')).toBe('deny')
      },
    },
    run,
    [
      hook('permission-request', { matcher: 'Dangerous', command: 'exit 2' }),
      hook('permission-response'),
    ],
    report,
    repair,
  )
  expect(run.approve).not.toHaveBeenCalled()
  expect(JSON.parse(report.mock.calls[1]?.[0].output ?? '')).toMatchObject({
    permission: { decision: 'deny' },
  })
})
it('matches shared categories and native names without running unrelated hooks', async () => {
  const { run, report, repair } = fixture()
  await runWithHooks(
    {
      run: async (input) => {
        input.onEvent?.('item/started', {
          item: { id: 'a', type: 'commandExecution', command: 'pwd' },
        })
        input.onEvent?.('item/started', { item: { id: 'b', type: 'fileChange' } })
      },
    },
    run,
    [hook('tool-start', { matcher: '^command$' })],
    report,
    repair,
  )
  expect(report).toHaveBeenCalledOnce()
  expect(JSON.parse(report.mock.calls[0]?.[0].output ?? '')).toMatchObject({ tool: { id: 'a' } })
})
it('gates the turn before starting a provider and reports the original error to error hooks', async () => {
  const { run, report, repair } = fixture()
  const adapter = { run: vi.fn<(input: AgentRun) => Promise<void>>() }
  await expect(
    runWithHooks(
      adapter,
      run,
      [hook('before-turn', { command: 'exit 1' }), hook('turn-error')],
      report,
      repair,
    ),
  ).rejects.toThrow('Before-turn hooks failed')
  expect(adapter.run).not.toHaveBeenCalled()
  expect(JSON.parse(report.mock.calls[1]?.[0].output ?? '')).toMatchObject({
    event: 'turn-error',
    error: 'Before-turn hooks failed: before-turn',
  })
})
it('runs interruption cleanup after abort and does not run after-turn', async () => {
  const controller = new AbortController()
  const { run, report, repair } = fixture({ signal: controller.signal })
  await expect(
    runWithHooks(
      {
        run: async () => {
          controller.abort()
          controller.signal.throwIfAborted()
        },
      },
      run,
      [hook('turn-interrupted'), hook('after-turn')],
      report,
      repair,
    ),
  ).rejects.toThrow('aborted')
  expect(report).toHaveBeenCalledOnce()
  expect(JSON.parse(report.mock.calls[0]?.[0].output ?? '')).toMatchObject({
    event: 'turn-interrupted',
  })
})
it('preserves provider errors when failure cleanup fails too', async () => {
  const { run, report, repair } = fixture()
  await expect(
    runWithHooks(
      {
        run: async () => {
          throw new Error('provider disconnected')
        },
      },
      run,
      [hook('turn-error', { command: 'exit 1' })],
      report,
      repair,
    ),
  ).rejects.toThrow('provider disconnected; failure cleanup also failed')
})
it.each([true, false])(
  'runs manual compaction checks once, with native acknowledgement=%s',
  async (acknowledged) => {
    const { run, report, repair } = fixture({ compact: true })
    await runWithHooks(
      {
        run: async (input) => {
          if (acknowledged) {
            input.onEvent?.('dovo/compaction/completed', {})
            input.onEvent?.('dovo/compaction/completed', {})
          }
        },
      },
      run,
      [
        hook('before-compaction'),
        hook('after-compaction'),
        hook('before-turn'),
        hook('after-turn'),
      ],
      report,
      repair,
    )
    expect(report.mock.calls.map(([result]) => result.hook.event)).toEqual([
      'before-compaction',
      'after-compaction',
    ])
    expect(JSON.parse(report.mock.calls[1]?.[0].output ?? '')).toMatchObject({ trigger: 'manual' })
  },
)
it('propagates failed manual post-compaction checks', async () => {
  const { run, report, repair } = fixture({ compact: true })
  await expect(
    runWithHooks(
      { run: async () => {} },
      run,
      [hook('after-compaction', { command: 'exit 1' })],
      report,
      repair,
    ),
  ).rejects.toThrow('After-compaction hooks failed')
})
it('rejects active hooks in read-only tasks and skips disabled hooks', async () => {
  const { run, report, repair } = fixture()
  run.agent.permission = 'read-only'
  const adapter = { run: vi.fn<(input: AgentRun) => Promise<void>>(async () => {}) }
  await expect(runWithHooks(adapter, run, [hook('tool-start')], report, repair)).rejects.toThrow(
    'require write access',
  )
  await runWithHooks(adapter, run, [hook('tool-start', { enabled: false })], report, repair)
  expect(adapter.run).toHaveBeenCalledWith(run)
})
it('validates matchers and preserves existing configurations with no matcher', () => {
  expect(decode(agentHookSchema, hook('after-turn'))).toEqual(hook('after-turn'))
  expect(decode(agentHookSchema, hook('tool-start', { matcher: '*' })).matcher).toBe('*')
  expect(() => decode(agentHookSchema, hook('tool-start', { matcher: '[' }))).toThrow(
    'regular expression',
  )
  expect(
    mergeResources(
      { mcpServers: [], skills: [], hooks: [hook('after-turn')] },
      { mcpServers: [], skills: [], hooks: [hook('after-turn', { enabled: false })] },
    ).hooks,
  ).toEqual([hook('after-turn', { enabled: false })])
})

it('denies an approval when its hook times out and reports the timeout', async () => {
  const { run, report, repair } = fixture()
  await runWithHooks(
    {
      run: async (input) => {
        expect(await input.approve('Run shell', 'pwd')).toBe('deny')
      },
    },
    run,
    [
      hook('permission-request', {
        timeoutSeconds: 1,
        command: `node -e 'setInterval(()=>{},1000)'`,
      }),
    ],
    report,
    repair,
  )
  expect(run.approve).not.toHaveBeenCalled()
  expect(report.mock.calls[0]?.[0]).toMatchObject({ ok: false, output: 'Hook timed out.\n' })
})
it('fails observational hooks after execution and ignores callbacks after the run ends', async () => {
  const { run, report, repair } = fixture()
  let emit: AgentRun['onEvent']
  let finished = false
  await expect(
    runWithHooks(
      {
        run: async (input) => {
          emit = input.onEvent
          input.onEvent?.('item/started', { item: { id: 't', type: 'commandExecution' } })
          finished = true
        },
      },
      run,
      [hook('tool-start', { command: 'exit 1' }), hook('turn-error')],
      report,
      repair,
    ),
  ).rejects.toThrow('Lifecycle hooks failed')
  expect(finished).toBe(true)
  expect(repair).not.toHaveBeenCalled()
  emit?.('item/started', { item: { id: 'late', type: 'commandExecution' } })
  await new Promise((resolve) => setImmediate(resolve))
  expect(report).toHaveBeenCalledTimes(2)
})
