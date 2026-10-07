import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Run, RunResult, SDKMessage, SendOptions, AgentOptions } from '@cursor/sdk'
import { defaultTaskHarness, decode, mcpServerSchema } from '@dovo/protocol'
import { cursorModels, cursorOptions, cursorSelection, cursorSession } from './cursor-runtime.js'
import type { CursorInput, CursorEvent } from './cursor-runtime.js'
import { createCursorAdapter, openCursorWorker } from './cursor.js'
import type { AgentRun } from '../../execution/types.js'
import { toolEvent } from '../../execution/tool-event.js'
import { ReasoningEvents } from '../../execution/reasoning-event.js'
import { turnTokenCounter } from '../../tasks/context-usage.js'
import { completedCompaction } from '../../tasks/compaction.js'

const input: CursorInput = {
  cwd: '/workspace',
  model: 'example',
  reasoning: '',
  permission: 'full-access',
  prompt: 'hello',
  images: [],
  mcpServers: {
    dovo: {
      type: 'http',
      url: 'http://127.0.0.1:1234/mcp',
      headers: { Authorization: 'Bearer thread-token' },
    },
  },
}
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function sdkFixture() {
  const events: CursorEvent[] = []
  const messages: SDKMessage[] = []
  let sendOptions: SendOptions | undefined
  let result: Promise<RunResult> = Promise.resolve({
    id: 'run',
    status: 'finished',
    result: 'fallback',
  })
  const cancel = vi.fn<() => Promise<void>>(async () => {})
  const steer = vi.fn<NonNullable<Run['steer']>>(async () => 'complete_delivered')
  const sdkRun: Run = {
    id: 'run',
    agentId: 'session',
    status: 'running',
    supports: () => true,
    unsupportedReason: () => undefined,
    async *stream() {
      yield* messages
    },
    wait: () => result,
    cancel,
    steer,
    conversation: async () => [],
    onDidChangeStatus: () => () => {},
  }
  const send = vi.fn<import('@cursor/sdk').SDKAgent['send']>(
    async (
      _message: Parameters<import('@cursor/sdk').SDKAgent['send']>[0],
      options?: SendOptions,
    ) => {
      sendOptions = options
      return sdkRun
    },
  )
  const dispose = vi.fn<() => Promise<void>>(async () => {})
  const agent = { agentId: 'session', send, [Symbol.asyncDispose]: dispose }
  const factory = {
    create: vi.fn<(options: AgentOptions) => Promise<typeof agent>>(async (_options) => agent),
    resume: vi.fn<(id: string, options: AgentOptions) => Promise<typeof agent>>(
      async (_id, _options) => agent,
    ),
  }
  const session = cursorSession((event) => events.push(event), factory)
  return {
    events,
    messages,
    factory,
    session,
    dispose,
    cancel,
    steer,
    send,
    options: () => sendOptions,
    result: (value: Promise<RunResult>) => {
      result = value
    },
  }
}

it('retains SDK model variants and advertised reasoning parameters across selection', () => {
  const catalog = cursorModels([
    {
      id: 'router',
      displayName: 'Router',
      parameters: [
        {
          id: 'effort',
          values: [
            { value: 'low', displayName: 'Low' },
            { value: 'high', displayName: 'High' },
          ],
        },
      ],
      variants: [
        {
          displayName: 'Fast',
          params: [
            { id: 'optimize_for', value: 'speed' },
            { id: 'effort', value: 'low' },
          ],
          isDefault: true,
        },
      ],
    },
  ])
  expect(catalog.models[0]).toMatchObject({ name: 'Router · Fast', isDefault: true })
  expect(cursorSelection(catalog.models[0].id, catalog.reasoning[1].id)).toEqual({
    id: 'router',
    params: [
      { id: 'optimize_for', value: 'speed' },
      { id: 'effort', value: 'high' },
    ],
  })
  expect(cursorSelection('custom-model', '')).toEqual({ id: 'custom-model' })
  expect(() => cursorSelection('', '')).toThrow('Choose a Cursor model')
  expect(() => cursorSelection('{"id":42}', '')).toThrow(/string/)
  expect(() => cursorSelection('custom-model', 'high')).toThrow(/JSON|Unexpected token/)
})
it('uses exact native modes without granting ambient MCP or subagents to restricted runs', () => {
  expect(cursorOptions({ ...input, permission: 'read-only' })).toMatchObject({
    tools: ['read', 'grep', 'glob', 'ls'],
    disallowedTools: ['mcp', 'task', 'askQuestion'],
    mcpServers: {},
    local: { settingSources: [], autoReview: false, enableAgentRetries: false },
  })
  expect(cursorOptions({ ...input, tools: 'none', permission: 'auto' })).toMatchObject({
    tools: [],
    mcpServers: {},
    local: { settingSources: [], autoReview: false },
  })
  expect(cursorOptions({ ...input, permission: 'auto' })).toMatchObject({
    mcpServers: input.mcpServers,
    disallowedTools: ['askQuestion'],
    local: { autoReview: true, settingSources: ['all'], subagentInherit: {} },
  })
  expect(cursorOptions(input).tools).toBeUndefined()
})
it('streams separate assistant messages without duplicating snapshots and preserves tool and summary events', async () => {
  const f = sdkFixture()
  f.messages.push(
    {
      type: 'assistant',
      agent_id: 'session',
      run_id: 'run',
      message: { role: 'assistant', content: [{ type: 'text', text: 'SNAPSHOT' }] },
    },
    {
      type: 'tool_call',
      agent_id: 'session',
      run_id: 'run',
      call_id: 't',
      name: 'read',
      status: 'completed',
    },
  )
  let resolve: (result: RunResult) => void = () => {}
  f.result(
    new Promise((yes) => {
      resolve = yes
    }),
  )
  const running = f.session.run(input)
  await vi.waitFor(() => expect(f.options()).toBeDefined())
  const options = f.options()!
  await options.onDelta?.({ update: { type: 'text-delta', text: 'Working.' } })
  await options.onStep?.({ step: { type: 'assistantMessage', message: { text: 'Working.' } } })
  await options.onDelta?.({ update: { type: 'text-delta', text: 'long' } })
  await options.onDelta?.({ update: { type: 'step-completed', stepId: 2, stepDurationMs: 1 } })
  await options.onDelta?.({ update: { type: 'text-delta', text: '-press.' } })
  await options.onDelta?.({ update: { type: 'summary-completed' } })
  resolve({ id: 'run', status: 'finished', result: 'Working.long-press.' })
  await running
  expect(f.events.filter((event) => event.type === 'text')).toEqual([
    { type: 'text', text: 'Working.' },
    { type: 'text', text: 'long' },
    { type: 'text', text: '-press.' },
  ])
  expect(f.events.filter((event) => event.type === 'boundary')).toHaveLength(1)
  const tool = f.events.find((event) => event.type === 'event' && event.name === 'cursor/tool_call')
  expect(tool?.type === 'event' && toolEvent('cursor', tool.name, tool.payload)).toEqual({
    toolId: 't',
    title: 'read',
    status: 'completed',
  })
  expect(
    f.events.some(
      (event) =>
        event.type === 'event' &&
        completedCompaction('cursor', event.name, event.payload) === 'auto',
    ),
  ).toBe(true)
  expect(f.dispose).toHaveBeenCalledOnce()
})
it('reapplies tools and MCP overrides on resume, and uses SDK fallback text only without deltas', async () => {
  const f = sdkFixture()
  await f.session.run({ ...input, sessionId: 'session', permission: 'read-only' })
  expect(f.factory.create).not.toHaveBeenCalled()
  expect(f.factory.resume).toHaveBeenCalledWith(
    'session',
    expect.objectContaining({ tools: ['read', 'grep', 'glob', 'ls'], mcpServers: {} }),
  )
  expect(f.events).toContainEqual({ type: 'text', text: 'fallback' })
})
it('reports per-turn usage once and never substitutes the SDK cumulative result', async () => {
  const f = sdkFixture()
  f.messages.push({
    type: 'usage',
    agent_id: 'session',
    run_id: 'run',
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 4,
      cacheWriteTokens: 1,
      totalTokens: 17,
    },
  })
  f.result(
    Promise.resolve({
      id: 'run',
      status: 'finished',
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 400,
        cacheWriteTokens: 100,
        totalTokens: 1600,
      },
    }),
  )
  await f.session.run(input)
  const counter = turnTokenCounter('cursor', () => undefined)
  for (const event of f.events)
    if (event.type === 'event') {
      counter.accept(event.name, event.payload)
      counter.accept(event.name, event.payload)
    }
  expect(counter.total()).toBe(17)
  expect(counter.usage()).toEqual({ input: 10, output: 2, cacheRead: 4, cacheWrite: 1 })
})
it('collects separate exposed thinking segments and finishes them at SDK boundaries', () => {
  const rows: unknown[] = [],
    reasoning = new ReasoningEvents('cursor', (row) => rows.push(row))
  reasoning.accept('cursor/thinking', { id: 0, text: 'First' })
  reasoning.accept('cursor/thinking-completed', { id: 0 })
  reasoning.accept('cursor/thinking', { id: 1, text: 'Second' })
  reasoning.finish()
  expect(rows).toMatchObject([
    { toolId: 'reasoning:cursor:0', status: 'completed', reasoning: { text: 'First' } },
    { toolId: 'reasoning:cursor:1', status: 'completed', reasoning: { text: 'Second' } },
  ])
})
it.each(['error', 'cancelled'] as const)(
  'rejects %s terminals and always disposes SDK resources',
  async (status) => {
    const f = sdkFixture()
    f.result(Promise.resolve({ id: 'run', status, error: { message: 'Terminal failure' } }))
    await expect(f.session.run(input)).rejects.toThrow('Terminal failure')
    expect(f.dispose).toHaveBeenCalledOnce()
  },
)
it('accepts only acknowledged SDK steering, refusing a second injection', async () => {
  const f = sdkFixture()
  let resolve: (result: RunResult) => void = () => {}
  f.result(
    new Promise((yes) => {
      resolve = yes
    }),
  )
  const pending = f.session.run(input)
  await vi.waitFor(() => expect(f.events).toContainEqual({ type: 'accepted', steer: true }))
  await f.session.steer('clarify')
  await expect(f.session.steer('more')).rejects.toThrow('cannot accept')
  expect(f.steer).toHaveBeenCalledOnce()
  resolve({ id: 'run', status: 'finished' })
  await pending
})
it('does not transfer ownership for steering returned as a follow-up', async () => {
  const f = sdkFixture()
  f.steer.mockResolvedValue('revert_to_followup')
  let resolve: (result: RunResult) => void = () => {}
  f.result(
    new Promise((yes) => {
      resolve = yes
    }),
  )
  const pending = f.session.run(input)
  await vi.waitFor(() => expect(f.events).toContainEqual({ type: 'accepted', steer: true }))
  await expect(f.session.steer('clarify')).rejects.toThrow('follow-up')
  resolve({ id: 'run', status: 'finished' })
  await pending
})
it('honors cancellation while SDK creation is still pending', async () => {
  const f = sdkFixture()
  let resolve: (agent: Awaited<ReturnType<typeof f.factory.create>>) => void = () => {}
  f.factory.create.mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes
      }),
  )
  const pending = f.session.run(input)
  await f.session.cancel()
  resolve({ agentId: 'late', send: f.send, [Symbol.asyncDispose]: f.dispose })
  await expect(pending).rejects.toThrow('cancelled')
  expect(f.send).not.toHaveBeenCalled()
  expect(f.dispose).toHaveBeenCalledOnce()
})

async function wireFixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-cursor-wire-'))
  directories.push(cwd)
  const script = join(cwd, 'worker.mjs')
  await writeFile(
    script,
    `
import {createMessageConnection, IPCMessageReader, IPCMessageWriter} from ${JSON.stringify(import.meta.resolve('vscode-jsonrpc/node'))};
const rpc=createMessageConnection(new IPCMessageReader(process),new IPCMessageWriter(process));
const event=value=>rpc.sendNotification('event',value);let finish;
rpc.onRequest('models',()=>({models:[{id:'example',name:process.env.TEST_ID}],reasoning:[]}));
rpc.onRequest('probe',()=>({authenticated:true}));
rpc.onRequest('steer',()=>null);
rpc.onRequest('cancel',()=>{if(finish)finish(null);return null});
rpc.onRequest('run',async input=>{
 await event({type:'session',id:'session'});await event({type:'accepted',steer:true});
 if(input.prompt==='disconnect'){process.exit(0)}
 if(input.prompt==='hold')return new Promise(resolve=>{finish=resolve});
 await event({type:'text',text:JSON.stringify({input,env:process.env.TEST_ID,owner:process.env.DOVO_OWNER_TOKEN})});return null;
});rpc.listen();`,
  )
  const adapter = createCursorAdapter((agent, dir) =>
    openCursorWorker(agent, dir, pathToFileURL(script)),
  )
  const texts: string[] = [],
    sessions: string[] = []
  const run: AgentRun = {
    agent: {
      ...defaultTaskHarness('cursor'),
      id: 'a',
      name: 'Cursor',
      model: 'example',
      env: { TEST_ID: 'isolated', DOVO_OWNER_TOKEN: 'secret' },
    },
    cwd,
    prompt: 'hello',
    signal: new AbortController().signal,
    onText: (text) => texts.push(text),
    onSession: (id) => sessions.push(id),
    onActivity: () => {},
    approve: async () => false,
    ask: async () => null,
  }
  return { adapter, run, texts, sessions }
}
it('uses owned IPC workers with isolated environment and thread-scoped input, discovery and authentication', async () => {
  const f = await wireFixture()
  expect(await f.adapter.models?.(f.run.agent)).toMatchObject({ models: [{ name: 'isolated' }] })
  expect(await f.adapter.probe(f.run.agent)).toMatchObject({ available: true, provider: 'cursor' })
  await f.adapter.run({
    ...f.run,
    ephemeral: true,
    agent: {
      ...f.run.agent,
      instructions: 'Instructions',
      resources: {
        skills: [],
        mcpServers: [
          decode(mcpServerSchema, {
            name: 'dovo',
            enabled: true,
            transport: 'http',
            url: 'http://127.0.0.1/mcp',
            headerValues: { Authorization: 'Bearer thread' },
          }),
        ],
      },
    },
  })
  expect(f.sessions).toEqual(['session'])
  const sent = JSON.parse(f.texts[0])
  expect(sent).toMatchObject({
    env: 'isolated',
    input: {
      prompt: 'Instructions\n\nhello',
      mcpServers: { dovo: { type: 'http', headers: { Authorization: 'Bearer thread' } } },
    },
  })
  expect(sent.owner).toBeUndefined()
  expect(sent.input.storeDirectory).toContain('dovo-cursor-')
  await expect(
    import('node:fs/promises').then((fs) => fs.stat(sent.input.storeDirectory)),
  ).rejects.toThrow(/ENOENT/)
})
it('cancels an admitted worker turn and rejects unexpected worker closure', async () => {
  const f = await wireFixture(),
    controller = new AbortController()
  await expect(
    f.adapter.run({
      ...f.run,
      prompt: 'hold',
      signal: controller.signal,
      onPromptAccepted: () => controller.abort(new Error('Stopped')),
    }),
  ).rejects.toThrow('Stopped')
  await expect(f.adapter.run({ ...f.run, prompt: 'disconnect' })).rejects.toThrow(/exited|closed/)
})
it('rejects unsupported modes and manual compaction before launching SDK work', async () => {
  const f = await wireFixture()
  await expect(f.adapter.run({ ...f.run, compact: true })).rejects.toThrow('no manual compaction')
  await expect(
    f.adapter.run({ ...f.run, agent: { ...f.run.agent, permission: 'ask' } }),
  ).rejects.toThrow('native mode')
  expect(f.sessions).toHaveLength(0)
})

it('rejects cloud session identities before the SDK can route a resume remotely', async () => {
  const f = sdkFixture()
  await expect(f.session.run({ ...input, sessionId: 'bc-cloud' })).rejects.toThrow('cloud sessions')
  expect(f.factory.resume).not.toHaveBeenCalled()
})
it('does not resolve unused MCP secrets in read-only sessions', async () => {
  const f = await wireFixture()
  await f.adapter.run({
    ...f.run,
    agent: {
      ...f.run.agent,
      permission: 'read-only',
      resources: {
        skills: [],
        mcpServers: [
          decode(mcpServerSchema, {
            name: 'unused',
            enabled: true,
            transport: 'http',
            url: 'http://127.0.0.1/mcp',
            headerEnv: { Authorization: 'DOVO_TEST_MISSING_CURSOR_SECRET' },
          }),
        ],
      },
    },
  })
  const sent: unknown = JSON.parse(f.texts[0])
  expect(sent).toMatchObject({ input: { mcpServers: {} } })
})
it('starts the real SDK worker and reports configuration errors without running inference', async () => {
  const f = await wireFixture()
  await expect(
    createCursorAdapter().run({ ...f.run, agent: { ...f.run.agent, model: '' } }),
  ).rejects.toThrow('Choose a Cursor model')
})
