import * as warmProcesses from '../../execution/warm-processes.js'
import { decode, mcpServerSchema } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { readFile, rm, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHermesAdapter, hermesModels } from './hermes.js'
import { hermesConfig } from './hermes-config.js'
import { providerFixture } from '../shared/provider-fixture.js'
import type { AgentAdapter } from '../../execution/types.js'
const directories: string[] = [],
  adapters: AgentAdapter[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(adapters.splice(0).map(async (adapter) => adapter.dispose?.()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
const defaultCatalog = {
  model: 'a',
  provider: 'nous',
  providers: [
    {
      slug: 'nous',
      name: 'Nous',
      authenticated: true,
      models: ['a', 'b'],
      capabilities: { a: { reasoning: false }, b: { reasoning: true } },
    },
  ],
}
async function fixture(
  catalog: unknown = defaultCatalog,
  events?: Array<{ type: string; payload?: Record<string, unknown> }>,
) {
  const f = await providerFixture(
    'hermes',
    String.raw`
const {createInterface}=require('node:readline'); const {writeFileSync,readFileSync}=require('node:fs');const messages=[];
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const reply=(id,result)=>send({id,result});const event=(type,payload={})=>send({method:'event',params:{type,session_id:'runtime',payload}});
let prompt=''; event('gateway.ready');
createInterface({input:process.stdin}).on('line',line=>{
 const value=JSON.parse(line);messages.push(value);writeFileSync(process.env.TEST_RECORD,JSON.stringify(messages));
 const p=value.params||{};
 if(value.method==='model.options')return reply(value.id,JSON.parse(process.env.TEST_CATALOG));
 if(value.method==='session.create'||value.method==='session.resume')return reply(value.id,{session_id:'runtime',stored_session_id:'stored'});
 if(value.method==='session.steer'){event('message.delta',{text:p.text});reply(value.id,{status:'queued'});event('message.complete',{text:'Hello '+p.text,status:'complete'});return}
 if(value.method==='session.compress')return reply(value.id,{status:'compressed',usage:{context_used:12,context_max:1000}});
 if(value.method==='session.interrupt'){reply(value.id,{});return}
 if(value.method==='prompt.submit'){
  prompt=p.text;reply(value.id,{status:'streaming'});
  if(process.env.TEST_EVENTS){for(const frame of JSON.parse(process.env.TEST_EVENTS))event(frame.type,frame.payload);return}
  event('message.start');event('message.delta',{text:'Hello '});
  if(prompt==='hold')return;
  if(prompt==='fail'){event('message.complete',{text:'Hello ',status:'error',error:'Provider failed'});return}
  if(prompt==='approval'){send({id:'a-1',method:'approval',params:{session_id:'runtime',tool_name:'terminal',description:'Run command',command:'pwd'}});return}
  if(prompt==='question'){send({id:'q-1',method:'clarify',params:{session_id:'runtime',questions:[{qid:'answer',question:'Continue?',choices:['yes','no']}]}});return}
  event('tool.start',{tool_id:'t',name:'terminal',args:{command:'pwd'}});event('tool.complete',{tool_id:'t',name:'terminal',result:{}});
  event('message.interim',{text:'Hello ',already_streamed:true});event('message.delta',{text:'Done.'});event('message.complete',{text:'Done.',status:'complete',usage:{context_used:42,context_max:1000}});return;
 }
 if(!value.method){event('message.complete',{text:'Hello ',status:'complete'});return}
 reply(value.id,{});
});`,
  )
  f.run.agent.env = {
    ...f.run.agent.env,
    TEST_CATALOG: JSON.stringify(catalog),
    ...(events ? { TEST_EVENTS: JSON.stringify(events) } : {}),
  }
  directories.push(f.cwd)
  const adapter = createHermesAdapter()
  adapters.push(adapter)
  return { ...f, adapter }
}
for (const kind of ['modern', 'legacy', 'forwarding'] as const) {
  const legacy = kind !== 'modern'
  it.runIf(process.platform !== 'win32')(
    `discovers, probes and runs an installed ${kind} Hermes outside PATH`,
    async () => {
      const f = await fixture()
      const bin = join(f.cwd, '.local', 'bin'),
        command = join(bin, 'hermes')
      await mkdir(bin, { recursive: true })
      const expected = legacy
        ? ['-u', '-P', '-m', 'tui_gateway.entry']
        : ['--run-module', 'tui_gateway.entry']
      const script =
        (legacy
          ? "if (process.env.PYTHONHOME || process.env.PYTHONPATH) throw new Error('Installer environment cleanup was bypassed');\n"
          : '') +
        `if (JSON.stringify(process.argv.slice(2)) !== ${JSON.stringify(JSON.stringify(expected))}) throw new Error('Incorrect Hermes gateway arguments');\n` +
        (await readFile(f.script, 'utf8'))
      if (legacy) {
        const python = join(bin, 'python3')
        await writeFile(python, `#!${process.execPath}\n${script}`, { mode: 0o755 })
        await writeFile(
          command,
          `#!/bin/sh\nunset PYTHONPATH\nunset PYTHONHOME\nexec "${python}" "${join(f.cwd, 'hermes')}" "$@"\n`,
          { mode: 0o755 },
        )
        if (kind === 'forwarding') {
          const nestedBin = join(f.cwd, '.hermes', 'hermes-agent', '.hermes', 'bin')
          const nested = join(nestedBin, 'hermes')
          await mkdir(nestedBin, { recursive: true })
          await writeFile(nested, `#!${python}\nfrom hermes_cli.main import main\n`)
          await writeFile(command, `#!/bin/sh\nexec ${nested} "$@"\n`, { mode: 0o755 })
        }
      } else {
        await writeFile(command, `#!${process.execPath}\n${script}`, { mode: 0o755 })
      }
      const agent = {
        ...f.run.agent,
        endpoint: '',
        args: [],
        env: {
          ...f.run.agent.env,
          HOME: f.cwd,
          PATH: '',
          ...(legacy ? { PYTHONHOME: '/foreign-python', PYTHONPATH: '/foreign-modules' } : {}),
        },
      }
      expect(await f.adapter.probe?.(agent)).toMatchObject({ provider: 'hermes', available: true })
      expect((await hermesModels(agent)).models.map((model) => model.id)).toEqual([
        'nous:a',
        'nous:b',
      ])
      await f.adapter.run({ ...f.run, agent })
      expect(f.output.join('')).toBe('Hello Done.')
    },
  )
}
it('uses native sessions, separate message boundaries, tools and final response without duplication', async () => {
  const f = await fixture(),
    boundary = vi.fn<() => void>()
  await f.adapter.run({
    ...f.run,
    agent: { ...f.run.agent, model: 'nous:b', reasoning: 'high' },
    onTextBoundary: boundary,
  })
  expect(f.output.join('')).toBe('Hello Done.')
  expect(boundary).toHaveBeenCalledOnce()
  expect(f.sessions).toEqual(['stored'])
  expect(f.events.map((event) => event.name)).toContain('tool.complete')
  const wire = await f.messages()
  expect(wire.find((frame) => frame.method === 'session.create')?.params).toEqual({
    cwd: f.cwd,
    source: 'dovo',
    close_on_disconnect: true,
    hidden: false,
  })
  expect(wire.find((frame) => frame.method === 'config.set')?.params).toMatchObject({
    key: 'model',
    value: 'b --provider nous --session',
    scope: 'session',
  })
  expect(wire.some((frame) => frame.method === 'initialize')).toBe(false)
})
it.each([
  {
    streamed: ' \nSent "I love you ❤️" on WhatsApp. \n',
    final: 'Sent "I love you ❤️" on WhatsApp.',
  },
  { streamed: 'Confrmed.', final: 'Confirmed.' },
  { streamed: 'Draft response.', final: 'A revised final answer.' },
  { streamed: 'Done.', final: 'Done. More details.' },
  { streamed: 'Keep this reply.', final: ' \n' },
  { streamed: '', final: 'A non-streamed reply.' },
])('settles canonical text without failing ($streamed → $final)', async ({ streamed, final }) => {
  const f = await fixture(defaultCatalog, [
    { type: 'message.start' },
    { type: 'message.delta', payload: { text: streamed } },
    { type: 'message.complete', payload: { text: final, status: 'complete' } },
  ])
  await f.adapter.run(f.run)
  expect(f.output.join('')).toBe(final.trim() ? final : streamed)
})
it('reconciles interim text before sealing it and preserves progress before the final reply', async () => {
  const f = await fixture(defaultCatalog, [
    { type: 'message.start' },
    { type: 'message.delta', payload: { text: ' \nPlanning. \n' } },
    { type: 'message.interim', payload: { text: 'Planning.', already_streamed: true } },
    { type: 'tool.start', payload: { tool_id: 't', name: 'terminal', args: { command: 'pwd' } } },
    { type: 'tool.complete', payload: { tool_id: 't', name: 'terminal', result: {} } },
    { type: 'message.delta', payload: { text: 'A draft final.' } },
    { type: 'message.complete', payload: { text: 'The final answer.', status: 'complete' } },
  ])
  const boundary = vi.fn<() => void>(() => expect(f.output.join('')).toBe('Planning.'))
  await f.adapter.run({ ...f.run, onTextBoundary: boundary })
  expect(boundary).toHaveBeenCalledOnce()
  expect(f.output.join('')).toBe('Planning.The final answer.')
  expect(f.events.map((event) => event.name)).toContain('tool.complete')
})
it.each([false, true])(
  'does not duplicate previewed final text (active stream=%s)',
  async (active) => {
    const f = await fixture(defaultCatalog, [
      { type: 'message.start' },
      { type: 'message.delta', payload: { text: ' \nDone. \n' } },
      ...(active
        ? []
        : [{ type: 'message.interim', payload: { text: 'Done.', already_streamed: true } }]),
      {
        type: 'message.complete',
        payload: { text: 'Done.', status: 'complete', response_previewed: true },
      },
    ])
    await f.adapter.run(f.run)
    expect(f.output.join('')).toBe('Done.')
  },
)
it('preserves a real provider failure after reconciling its text', async () => {
  const f = await fixture(defaultCatalog, [
    { type: 'message.start' },
    { type: 'message.delta', payload: { text: 'Draft failure.' } },
    {
      type: 'message.complete',
      payload: { text: 'Final failure.', status: 'error', error: 'Provider unavailable' },
    },
  ])
  await expect(f.adapter.run(f.run)).rejects.toThrow('Provider unavailable')
  expect(f.output.join('')).toBe('Final failure.')
})
it('discovers provider-qualified native models and per-model reasoning', async () => {
  const f = await fixture()
  const catalog = await hermesModels(f.run.agent)
  expect(catalog.models).toMatchObject([
    { id: 'nous:a', reasoning: [] },
    { id: 'nous:b', reasoning: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }] },
  ])
})
it('sends custom endpoint models without the picker hostname and retains their colon suffix', async () => {
  const f = await fixture({
    provider: 'custom',
    model: 'deepseek-v4.1-flash:dev',
    providers: [
      {
        slug: 'llm-proxy.dovo.dev',
        name: 'Electron Hub',
        is_current: true,
        authenticated: true,
        models: ['deepseek-v4.1-flash:dev'],
      },
    ],
  })
  const catalog = await hermesModels(f.run.agent)
  expect(catalog.models[0]).toMatchObject({
    id: 'llm-proxy.dovo.dev:deepseek-v4.1-flash:dev',
    name: 'deepseek-v4.1-flash:dev',
    isDefault: true,
  })
  await f.adapter.run({
    ...f.run,
    sessionId: 'stored',
    agent: { ...f.run.agent, model: catalog.models[0].id },
  })
  expect((await f.messages()).find((frame) => frame.method === 'config.set')?.params).toMatchObject(
    {
      key: 'model',
      value: 'deepseek-v4.1-flash:dev --provider custom --session',
      scope: 'session',
    },
  )
})
it('keeps duplicate models on distinct named endpoints and handles colon-containing provider keys', async () => {
  const f = await fixture({
    provider: 'custom:other',
    model: 'qwen:4b',
    providers: [
      { slug: 'local', name: 'Local', models: ['qwen:4b'] },
      { slug: 'custom:other', name: 'Other', aliases: ['custom:other'], models: ['qwen:4b'] },
    ],
  })
  const catalog = await hermesModels(f.run.agent)
  expect(catalog.models.map((model) => model.id)).toEqual(['local:qwen:4b', 'custom:other:qwen:4b'])
  await f.adapter.run({ ...f.run, agent: { ...f.run.agent, model: 'local:qwen:4b' } })
  expect((await f.messages()).find((frame) => frame.method === 'config.set')?.params).toMatchObject(
    {
      value: 'qwen:4b --provider local --session',
    },
  )
  await f.adapter.run({ ...f.run, agent: { ...f.run.agent, model: 'custom:other:qwen:4b' } })
  expect((await f.messages()).find((frame) => frame.method === 'config.set')?.params).toMatchObject(
    {
      value: 'qwen:4b --provider custom:other --session',
    },
  )
})
it('leaves manually entered colon-containing model IDs intact', async () => {
  const f = await fixture()
  await f.adapter.run({ ...f.run, agent: { ...f.run.agent, model: 'deepseek-v4.1-flash:dev' } })
  expect((await f.messages()).find((frame) => frame.method === 'config.set')?.params).toMatchObject(
    {
      value: 'deepseek-v4.1-flash:dev --session',
    },
  )
})
it('retains a gateway across turns but refreshes its scoped MCP configuration on changes', async () => {
  vi.spyOn(warmProcesses, 'releaseIdleProvider').mockReturnValue(false)
  const f = await fixture()
  await f.adapter.run({ ...f.run, taskId: 'thread' })
  await f.adapter.run({ ...f.run, taskId: 'thread', sessionId: 'stored' })
  expect((await f.messages()).filter((frame) => frame.method === 'session.create')).toHaveLength(1)
  await f.adapter.run({
    ...f.run,
    taskId: 'thread',
    sessionId: 'stored',
    agent: { ...f.run.agent, instructions: 'New settings' },
  })
  expect((await f.messages()).some((frame) => frame.method === 'session.resume')).toBe(true)
})
it('uses native compression acknowledgements', async () => {
  const f = await fixture()
  await f.adapter.run({ ...f.run, sessionId: 'stored', compact: true })
  expect(f.events.map((event) => event.name)).toContain('dovo/compaction/completed')
  expect((await f.messages()).some((frame) => frame.method === 'prompt.submit')).toBe(false)
})
it('routes native approvals and clarification replies', async () => {
  const f = await fixture(),
    approve = vi.fn<() => Promise<boolean>>(async () => true)
  await f.adapter.run({ ...f.run, prompt: 'approval', approve })
  expect(approve).toHaveBeenCalledWith('Run command', 'pwd')
  expect((await f.messages()).find((frame) => frame.id === 'a-1')?.result).toEqual({
    choice: 'once',
  })
  await f.adapter.run({ ...f.run, prompt: 'question' })
  expect((await f.messages()).find((frame) => frame.id === 'q-1')?.result).toEqual({
    answers: { answer: 'yes' },
  })
})
it('steers the exact live native session and interrupts cancelled work', async () => {
  const f = await fixture()
  await f.adapter.run({
    ...f.run,
    prompt: 'hold',
    onSteer: (handler) => {
      if (handler) void handler({ id: 'steer', prompt: 'there' })
    },
  })
  expect(f.output.join('')).toBe('Hello there')
  const controller = new AbortController()
  const running = f.adapter.run({
    ...f.run,
    prompt: 'hold',
    signal: controller.signal,
    onPromptAccepted: () => controller.abort(new Error('Stop')),
  })
  await expect(running).rejects.toThrow('Stop')
  expect((await f.messages()).some((frame) => frame.method === 'session.interrupt')).toBe(true)
})
it('fails failed turns and rejects unsupported restricted execution before submitting', async () => {
  const f = await fixture()
  await expect(f.adapter.run({ ...f.run, prompt: 'fail' })).rejects.toThrow('Provider failed')
  await expect(f.adapter.run({ ...f.run, tools: 'none' })).rejects.toThrow('restricted tool-free')
})
it('keeps MCP credentials private and preserves managed policy and home', async () => {
  const f = await fixture(),
    directory = join(f.cwd, 'managed')
  await mkdir(directory)
  await writeFile(join(directory, 'config.yaml'), 'approvals:\n  mode: manual\ncustom: keep\n')
  await writeFile(join(directory, '.env'), 'ADMIN_SECRET=secret\n')
  const config = await hermesConfig({
    ...f.run.agent,
    env: { HERMES_MANAGED_DIR: directory },
    resources: {
      skills: [],
      mcpServers: [
        decode(mcpServerSchema, {
          name: 'dovo_task',
          transport: 'stdio',
          command: 'node',
          args: [],
          env: {},
          envValues: { TASK_TOKEN: 'scoped' },
          enabled: true,
        }),
      ],
    },
  })
  try {
    expect(await readFile(join(config.directory, 'config.yaml'), 'utf8')).toContain(
      'TASK_TOKEN: scoped',
    )
    expect(await readFile(join(config.directory, '.env'), 'utf8')).toContain('ADMIN_SECRET=secret')
    expect((await stat(join(config.directory, 'config.yaml'))).mode & 0o777).toBe(
      process.platform === 'win32' ? 0o666 : 0o600,
    )
    expect(await readFile(join(directory, 'config.yaml'), 'utf8')).toBe(
      'approvals:\n  mode: manual\ncustom: keep\n',
    )
  } finally {
    await config.close()
  }
  await expect(
    hermesConfig({
      ...f.run.agent,
      permission: 'full-access',
      env: { HERMES_MANAGED_DIR: directory },
    }),
  ).rejects.toThrow('administrator policy')
})
