import { decode, mcpServerSchema } from '@dovo/protocol'
import { spawnMspConnection } from '@muse-code/sdk'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { readFile, rm } from 'node:fs/promises'
import {
  createMuseAdapter,
  museApprovalChoice,
  museApprovalScopes,
  museApprovalTitle,
  museLaunch,
  museReasoningOptions,
  museSelection,
  museServeArgs,
  museVerbatimPath,
  museWorkspaceRoot,
  parseMuseVersion,
  resolveMuseReasoningEffort,
} from './muse.js'
import * as warmProcesses from '../../execution/warm-processes.js'
import type { AgentRun } from '../../execution/types.js'
import { providerFixture } from '../shared/provider-fixture.js'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const host = await readFile(new URL('./fixtures/muse-host.cjs', import.meta.url), 'utf8')
  const f = await providerFixture('muse', host)
  directories.push(f.cwd)
  return { ...f, adapter: createMuseAdapter() }
}
it('initializes availability, discovery and execution with a valid machine identifier', async () => {
  const f = await fixture()
  const host = spawnMspConnection({
    command: process.execPath,
    args: [f.script],
    cwd: f.cwd,
    env: { TEST_RECORD: f.record },
  })
  try {
    await expect(
      host.initialize({ clientInfo: { name: 'dovo-studio', version: '0.1.0' } }),
    ).rejects.toThrow('clientInfo.name must be a machine identifier')
  } finally {
    await host.close()
  }
  expect(await f.adapter.probe?.(f.run.agent)).toMatchObject({ available: true })
  expect((await f.messages()).find((frame) => frame.method === 'initialize')?.params).toMatchObject(
    {
      clientInfo: { name: 'dovo_studio', version: '0.1.0' },
    },
  )
  expect((await f.adapter.models?.(f.run.agent))?.models).toHaveLength(1)
  expect((await f.messages()).find((frame) => frame.method === 'initialize')?.params).toMatchObject(
    {
      clientInfo: { name: 'dovo_studio', version: '0.1.0' },
    },
  )
  await f.adapter.run(f.run)
  expect((await f.messages()).find((frame) => frame.method === 'initialize')?.params).toMatchObject(
    {
      clientInfo: { name: 'dovo_studio', version: '0.1.0' },
    },
  )
})
it('uses the SDK session fold for text boundaries, completion and provider-qualified models', async () => {
  const f = await fixture(),
    boundary = vi.fn<() => void>()
  await f.adapter.run({ ...f.run, onTextBoundary: boundary })
  expect(f.output.join('')).toBe('Working.Done.')
  expect(boundary).toHaveBeenCalledOnce()
  expect(f.sessions).toEqual(['s'])
  const catalog = await f.adapter.models?.(f.run.agent)
  expect(catalog?.models[0]).toMatchObject({
    id: JSON.stringify({ providerId: 'meta', modelId: 'a' }),
    name: 'A',
    isDefault: true,
    defaultReasoning: 'low',
    reasoning: [
      { id: 'low', name: 'Low' },
      { id: 'high', name: 'High' },
    ],
  })
})
it('requires granted session MCP and passes scoped tools without touching global settings', async () => {
  const f = await fixture()
  const agent = {
    ...f.run.agent,
    resources: {
      skills: [],
      mcpServers: [
        decode(mcpServerSchema, {
          name: 'dovo_task',
          transport: 'stdio' as const,
          command: 'node',
          args: [],
          env: {},
          envValues: { TOKEN: 'scoped' },
          enabled: true,
        }),
      ],
    },
  }
  await f.adapter.run({ ...f.run, agent })
  expect(
    (await f.messages()).find((frame) => frame.method === 'session/start')?.params,
  ).toMatchObject({
    config: { mcpServers: { dovo_task: { transport: 'stdio', env: { TOKEN: 'scoped' } } } },
  })
  await expect(
    f.adapter.run({ ...f.run, agent: { ...agent, env: { ...agent.env, NO_MCP: '1' } } }),
  ).rejects.toThrow('grant sessionMcp')
})
it('resumes without replaying history, applies native approval mode, and compacts', async () => {
  const f = await fixture()
  await f.adapter.run({ ...f.run, sessionId: 's', compact: true })
  const wire = await f.messages()
  expect(wire.find((frame) => frame.method === 'session/resume')?.params).toMatchObject({
    excludeItems: true,
  })
  expect(wire.find((frame) => frame.method === 'session/setApprovalMode')?.params).toMatchObject({
    mode: 'promptUnmatched',
  })
  expect(f.events.map((event) => event.name)).toContain('dovo/compaction/completed')
})
it('starts with a provider-qualified model and applies it on resume as a nested model selection', async () => {
  const f = await fixture()
  const model = JSON.stringify({ providerId: 'meta', modelId: 'a' })
  await f.adapter.run({ ...f.run, agent: { ...f.run.agent, model } })
  const started = (await f.messages()).find((frame) => frame.method === 'session/start')?.params
  expect(started).toMatchObject({ providerId: 'meta', modelId: 'a' })
  expect(started).not.toHaveProperty('model')
  await f.adapter.run({ ...f.run, agent: { ...f.run.agent, model }, sessionId: 's' })
  const wire = await f.messages()
  const setModel = wire.find((frame) => frame.method === 'session/setModel')?.params
  expect(setModel).toMatchObject({
    sessionId: 's',
    model: { providerId: 'meta', modelId: 'a' },
    commandId: expect.any(String),
  })
  expect(setModel).not.toHaveProperty('modelId')
  expect(setModel).not.toHaveProperty('providerId')
})
it('steers a live turn and reports failed or cancelled work', async () => {
  const f = await fixture()
  await f.adapter.run({
    ...f.run,
    prompt: 'hold',
    onSteer: (handler) => {
      if (handler) void handler({ id: 'steer', prompt: 'Continue' })
    },
  })
  expect(
    (await f.messages()).find((frame) => frame.method === 'turn/steer')?.params?.expectedTurnId,
  ).toBeTruthy()
  await expect(f.adapter.run({ ...f.run, prompt: 'fail' })).rejects.toThrow('Model failed')
  const controller = new AbortController()
  await expect(
    f.adapter.run({
      ...f.run,
      prompt: 'hold',
      signal: controller.signal,
      onPromptAccepted: () => controller.abort(new Error('Stop')),
    }),
  ).rejects.toThrow('Stop')
  expect((await f.messages()).some((frame) => frame.method === 'turn/interrupt')).toBe(true)
})
it('runs tool-free and read-only turns on a restricted host', async () => {
  const f = await fixture()
  await f.adapter.run({ ...f.run, tools: 'none' })
  expect(f.output.join('')).toBe('Working.Done.')
  const wire = await f.messages()
  const started = wire.find((frame) => frame.method === 'session/start')?.params
  expect(started).toMatchObject({ config: { mcpServers: {} } })
  const again = await fixture()
  await again.adapter.run({
    ...again.run,
    agent: { ...again.run.agent, permission: 'read-only' },
  })
  expect(again.output.join('')).toBe('Working.Done.')
})
it('settles the SDK turn on host EOF', async () => {
  const f = await fixture()
  await expect(f.adapter.run({ ...f.run, prompt: 'disconnect' })).rejects.toThrow(
    /closed|exited|hostExited|transportEof/,
  )
})

it('routes SDK approvals and native question commands', async () => {
  const f = await fixture(),
    approve = vi.fn<() => Promise<'approve'>>(async () => 'approve' as const)
  await f.adapter.run({ ...f.run, prompt: 'approval', approve })
  expect(approve).toHaveBeenCalledOnce()
  expect(
    (await f.messages()).find((frame) => frame.method === 'approval/decide')?.params,
  ).toMatchObject({ choiceId: 'once', requirementId: 'requirement' })
  await f.adapter.run({ ...f.run, prompt: 'question' })
  expect(
    (await f.messages()).find((frame) => frame.method === 'userInput/answer')?.params,
  ).toMatchObject({ answers: [{ questionId: 'answer', selectedLabel: 'yes' }] })
})

it('retains native children and approvals after a reply, reuses the host, and exposes stop', async () => {
  const f = await fixture()
  const pressure = vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(true)
  const native = vi.fn<NonNullable<AgentRun['onSubagentEvent']>>()
  const approve = vi.fn<NonNullable<AgentRun['nativeAgentInteractions']>['approve']>(
    async () => 'approve' as const,
  )
  let controls: Parameters<NonNullable<AgentRun['onNativeSession']>>[0] | undefined
  const run = {
    ...f.run,
    taskId: 'native-muse',
    prompt: 'native',
    onSubagentEvent: native,
    onNativeSession: (session: NonNullable<typeof controls>) => {
      controls = session
    },
    nativeAgentInteractions: { approve, ask: f.run.ask },
  }
  try {
    await f.adapter.run(run)
    await vi.waitFor(() => expect(approve).toHaveBeenCalledOnce())
    expect(native).not.toHaveBeenCalledWith('dovo/session/closed', {}, 's')
    await f.adapter.run({ ...run, prompt: 'hello', sessionId: 's' })
    expect((await f.messages()).filter((frame) => frame.method === 'initialize')).toHaveLength(1)
    await controls?.stop('child')
    await vi.waitFor(() =>
      expect(native).toHaveBeenCalledWith(
        'item/completed',
        expect.objectContaining({
          item: expect.objectContaining({ subagentId: 'child', controlStatus: 'closed' }),
        }),
        's',
      ),
    )
  } finally {
    await f.adapter.dispose?.()
    pressure.mockRestore()
  }
})

it('maps scoped approval decisions to the native choice and names the subject', async () => {
  const f = await fixture()
  const approve = vi.fn<AgentRun['approve']>(async () => 'session' as const)
  await f.adapter.run({ ...f.run, prompt: 'approval', approve })
  expect(approve).toHaveBeenCalledWith('Muse shell command: pwd', 'pwd', undefined, {
    session: true,
    always: true,
  })
  expect(
    (await f.messages()).find((frame) => frame.method === 'approval/decide')?.params,
  ).toMatchObject({ choiceId: 'session' })
})

it('surfaces retry, usage and todo events from the session', async () => {
  const f = await fixture()
  const activity: string[] = []
  await f.adapter.run({
    ...f.run,
    prompt: 'usage',
    onActivity: (value) => activity.push(value),
  })
  const names = f.events.map((event) => event.name)
  expect(names).toContain('session/contextUsage')
  expect(names).toContain('session/tokenUsage')
  expect(names).toContain('session/todoListChanged')
  const retried = await fixture()
  const retryActivity: string[] = []
  await retried.adapter.run({
    ...retried.run,
    prompt: 'retry',
    onActivity: (value) => retryActivity.push(value),
  })
  expect(retryActivity.some((value) => value.includes('retrying this turn (attempt 2 of 3)'))).toBe(
    true,
  )
})

it('builds reasoning options with labels, descriptions and fallbacks', () => {
  expect(
    museReasoningOptions({
      variants: ['low', 'high'],
      defaultReasoningEffort: 'high',
      reasoningEffortVariants: [{ tier: 'high', description: 'Deepest' }],
    }),
  ).toEqual({
    defaultEffort: 'high',
    reasoning: [
      { id: 'low', name: 'Low' },
      { id: 'high', name: 'High', description: 'Deepest' },
    ],
  })
  const fallback = museReasoningOptions({ variants: 'unknown' })
  expect(fallback.defaultEffort).toBe('high')
  expect(fallback.reasoning.map((option) => option.id)).toEqual([
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ])
  expect(museReasoningOptions({ variants: ['bogus'] }).reasoning).toEqual([])
  expect(
    resolveMuseReasoningEffort({ variants: ['low', 'high'], defaultReasoningEffort: 'low' }, 'max'),
  ).toBe('low')
  expect(resolveMuseReasoningEffort({ variants: 'unknown' }, undefined)).toBe('high')
})

it('derives serve arguments, custom selections, approval helpers and versions', () => {
  expect(museServeArgs({})).toEqual(['serve', '--trust-workspace'])
  expect(museServeArgs({ fullAccess: true })).toEqual([
    'serve',
    '--trust-workspace',
    '--disable-sandbox',
  ])
  expect(museServeArgs({ readOnly: true })).toEqual([
    'serve',
    '--disable-shell',
    '--disable-write',
    '--no-session-log',
  ])
  expect(museServeArgs({ readOnly: true, sessionLogging: true })).toEqual([
    'serve',
    '--disable-shell',
    '--disable-write',
  ])
  expect(museSelection('')).toBeUndefined()
  expect(museSelection('{"providerId":"meta","modelId":"a"}')).toEqual({
    providerId: 'meta',
    modelId: 'a',
  })
  expect(museSelection('custom-model-x')).toEqual({ providerId: 'meta', modelId: 'custom-model-x' })
  const request = {
    rawArgs: 'pwd',
    subject: { kind: 'shell', command: 'pwd' },
    availableChoices: [
      { choiceId: 'once', decision: 'approved', scope: 'once', label: 'Allow' },
      { choiceId: 'sess', decision: 'approvedForSession', scope: 'session', label: 'Session' },
      { choiceId: 'abort', decision: 'abort', scope: 'once', label: 'Reject' },
    ],
  }
  expect(museApprovalTitle(request)).toBe('Muse shell command: pwd')
  expect(museApprovalScopes(request)).toEqual({ session: true, always: false })
  expect(museApprovalChoice(request, 'approve')?.choiceId).toBe('once')
  expect(museApprovalChoice(request, 'session')?.choiceId).toBe('sess')
  expect(museApprovalChoice(request, 'deny')?.choiceId).toBe('abort')
  expect(museApprovalChoice(request, 'always')).toBeUndefined()
  expect(parseMuseVersion('muse 1.3.0-R2\n')).toBe('1.3.0-R2')
  expect(parseMuseVersion('no version')).toBeUndefined()
})

it('resolves Windows script launchers through PATH and PATHEXT under cmd.exe', () => {
  const env = {
    PATH: 'C:\\Tools;D:\\Muse Bin',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  }
  const exists = (path: string) => path === 'D:\\Muse Bin\\muse.CMD'
  expect(museLaunch('muse', 'win32', env, exists)).toEqual({
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/c', '@', 'D:\\Muse Bin\\muse.CMD'],
  })
  // A path without spaces escapes cmd metacharacters instead of quoting.
  const plain = { ...env, PATH: 'C:\\Tools' }
  expect(
    museLaunch('muse', 'win32', plain, (path) => path.toLowerCase() === 'c:\\tools\\muse.bat'),
  ).toEqual({
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/c', 'C:\\Tools\\muse.BAT'],
  })
  // Real executables run directly, and unresolved names pass through unchanged.
  expect(
    museLaunch('muse', 'win32', env, (path) => path.toLowerCase() === 'c:\\tools\\muse.exe'),
  ).toEqual({
    command: 'C:\\Tools\\muse.EXE',
    args: [],
  })
  expect(museLaunch('muse', 'win32', env, () => false)).toEqual({ command: 'muse', args: [] })
  expect(museLaunch('C:\\Muse\\muse.cmd', 'win32', env, () => true)).toEqual({
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/c', 'C:\\Muse\\muse.cmd'],
  })
  expect(museLaunch('C:\\Muse Apps\\muse.cmd', 'win32', env, () => true)).toEqual({
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/c', '@', 'C:\\Muse Apps\\muse.cmd'],
  })
  expect(museLaunch('muse', 'linux', env, () => false)).toEqual({ command: 'muse', args: [] })
})

it('forms verbatim Windows workspace roots and leaves other platforms alone', async () => {
  expect(museVerbatimPath('C:\\repo')).toBe('\\\\?\\C:\\repo')
  expect(museVerbatimPath('\\\\server\\share\\repo')).toBe('\\\\?\\UNC\\server\\share\\repo')
  expect(museVerbatimPath('\\\\?\\C:\\repo')).toBe('\\\\?\\C:\\repo')
  expect(await museWorkspaceRoot('/tmp/repo', 'linux')).toBe('/tmp/repo')
  expect(await museWorkspaceRoot('C:/missing/repo', 'win32')).toBe('\\\\?\\C:\\missing\\repo')
})

it.each(['approval-scoped', 'approval-always', 'subagent-approval'] as const)(
  'replays the recorded %s transcript through the adapter',
  async (name) => {
    const transcript = JSON.parse(
      await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
    ) as {
      prompt: string
      decision: 'approve' | 'session' | 'always' | 'deny'
      expectChoiceId: string
      expectSubagent?: boolean
      frames: Array<{ direction: string; frame: { method?: string; params?: unknown } }>
    }
    expect(transcript.frames.every((entry) => entry.direction === 'out')).toBe(true)
    const methods = transcript.frames.map((entry) => entry.frame.method)
    expect(methods).toContain('approval/requested')
    if (transcript.expectSubagent) expect(methods).toContain('item/started')
    const f = await fixture()
    const approve = vi.fn<AgentRun['approve']>(async () => transcript.decision)
    const nativeApprove = vi.fn<NonNullable<AgentRun['nativeAgentInteractions']>['approve']>(
      async () => transcript.decision,
    )
    const nativeEvents: string[] = []
    await f.adapter.run({
      ...f.run,
      prompt: transcript.prompt,
      approve,
      ...(transcript.expectSubagent
        ? {
            taskId: `replay-${name}`,
            onSubagentEvent: (event: string) => nativeEvents.push(event),
            nativeAgentInteractions: { approve: nativeApprove, ask: f.run.ask },
          }
        : {}),
    })
    if (transcript.expectSubagent) {
      await vi.waitFor(() => expect(nativeApprove).toHaveBeenCalled())
      expect(nativeEvents.length).toBeGreaterThan(0)
    }
    const decide = (await f.messages()).find((frame) => frame.method === 'approval/decide')
    expect(decide?.params).toMatchObject({ choiceId: transcript.expectChoiceId })
    if (transcript.expectSubagent) {
      await f.adapter.dispose?.()
    } else {
      expect(approve).toHaveBeenCalledWith(
        'Muse shell command: pwd',
        'pwd',
        undefined,
        expect.objectContaining({ session: true, always: true }),
      )
    }
  },
)
