import { afterEach, expect, it } from 'vite-plus/test'
import { rm } from 'node:fs/promises'
import { createAcpAdapter } from './acp.js'
import { providerFixture } from '../shared/provider-fixture.js'
import type { AgentSteer } from '../../execution/types.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture(version: number, response: string, grok = true) {
  const f = await providerFixture(
    'grok',
    String.raw`
const fs = require('node:fs'), readline = require('node:readline');
const messages = [], v2 = process.env.TEST_VERSION === '2'; let pending;
const send = m => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...m})+'\n');
const reply = (id, result) => send({id, result});
const update = update => send({method:'session/update',params:{sessionId:'s',update}});
const complete = reason => v2 ? update({sessionUpdate:'state_update',state:'idle',stopReason:reason}) : reply(pending, {stopReason:reason});
readline.createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line); messages.push(m); fs.writeFileSync(process.env.TEST_RECORD, JSON.stringify(messages));
  if(m.method === 'initialize') reply(m.id, v2
    ? {protocolVersion:2,info:{name:'grok',version:'1'},capabilities:{session:{}},authMethods:[{type:'agent',methodId:'cached_token',name:'Cached'}]}
    : {protocolVersion:1,agentCapabilities:{promptCapabilities:{image:false}},authMethods:[{id:'cached_token',name:'Cached'}]});
  else if(m.method === 'authenticate' || m.method === 'auth/login') reply(m.id, {});
  else if(m.method === 'session/new') reply(m.id, {sessionId:'s'});
  else if(m.method === 'session/prompt') {
    pending = m.id;
    if(v2) { update({sessionUpdate:'state_update',state:'running'}); reply(m.id,{messageId:'u'}); }
    else update({sessionUpdate:'tool_call',toolCallId:'tool',title:'Running',status:'in_progress'});
  } else if(m.method === '_x.ai/interject') {
    if(process.env.TEST_REPLY === 'exit') { process.exit(3); return; }
    reply(m.id, JSON.parse(process.env.TEST_REPLY));
    if(JSON.parse(process.env.TEST_REPLY)?.result?.status === 'queued' && m.params.text === 'Finish') setTimeout(() => complete('end_turn'), 20);
  } else if(m.method === 'session/cancel') complete('cancelled');
  else if(m.id !== undefined) reply(m.id, {});
});`,
  )
  cleanups.push(() => rm(f.cwd, { recursive: true, force: true }))
  const adapter = createAcpAdapter()
  cleanups.push(() => adapter.dispose?.() ?? Promise.resolve())
  f.run.agent.model = ''
  f.run.acpLaunch = {
    command: process.execPath,
    args: [f.script],
    ...(grok ? { authentication: 'grok' as const } : {}),
    env: {
      ...f.run.agent.env,
      DOVO_ACP_V2: version === 2 ? '1' : '0',
      TEST_VERSION: String(version),
      TEST_REPLY: response,
    },
  }
  const controller = new AbortController()
  f.run.signal = controller.signal
  let accepted = () => {}
  const ready = {
    promise: new Promise<void>((resolve) => {
      accepted = resolve
    }),
    resolve: () => accepted(),
  }
  f.run.onPromptAccepted = () => ready.resolve()
  let steer: AgentSteer | undefined
  f.run.onSteer = (value) => {
    steer = value
  }
  return { ...f, adapter, controller, ready, steer: () => steer }
}

it.each([1, 2])(
  'queues text and image steering over ACP v%i without interrupting tools',
  async (version) => {
    const f = await fixture(version, JSON.stringify({ result: { status: 'queued' } }))
    const running = f.adapter.run(f.run)
    await Promise.race([
      f.ready.promise,
      running.then(() => {
        throw new Error('Turn ended before acceptance')
      }),
    ])
    const steer = f.steer()
    if (!steer) throw new Error('Steering was not registered')
    await steer({
      id: 'image',
      prompt: 'Look',
      attachments: [
        {
          id: 'image',
          name: 'image.png',
          mime: 'image/png',
          size: 2,
          path: '/image.png',
          data: 'aGk=',
        },
      ],
    })
    await steer({ id: 'text', prompt: 'Finish' })
    await running
    const wire = await f.messages()
    expect(wire.filter((m) => m.method === '_x.ai/interject').map((m) => m.params)).toEqual([
      {
        sessionId: 's',
        text: 'Look',
        content: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
      },
      { sessionId: 's', text: 'Finish' },
    ])
    expect(wire.some((m) => m.method === 'session/cancel')).toBe(false)
    expect(wire.filter((m) => m.method === 'session/prompt')).toHaveLength(1)
    expect(f.steer()).toBeUndefined()
    await expect(steer({ id: 'late', prompt: 'Late' })).rejects.toThrow('ended')
  },
)

it.each(
  [1, 2].flatMap((version) =>
    ['{}', '{"status":"queued"}', '{"result":{"status":"rejected"}}'].map((response) => ({
      version,
      response,
    })),
  ),
)(
  'rejects nonqueued ACP v$version response $response and preserves the active turn',
  async ({ version, response }) => {
    const f = await fixture(version, response)
    const running = f.adapter.run(f.run)
    await Promise.race([
      f.ready.promise,
      running.then(() => {
        throw new Error('Turn ended before acceptance')
      }),
    ])
    const steer = f.steer()
    if (!steer) throw new Error('Steering was not registered')
    await expect(steer({ id: 'rejected', prompt: 'Late' })).rejects.toThrow('did not queue')
    expect((await f.messages()).some((m) => m.method === 'session/cancel')).toBe(false)
    f.controller.abort()
    await running
    expect(f.steer()).toBeUndefined()
  },
)

it.each([1, 2])('keeps steering unavailable for generic ACP v%i', async (version) => {
  const f = await fixture(version, '{}', false)
  const running = f.adapter.run(f.run)
  await Promise.race([
    f.ready.promise,
    running.then(() => {
      throw new Error('Turn ended before acceptance')
    }),
  ])
  expect(f.steer()).toBeUndefined()
  f.controller.abort()
  await running
  expect((await f.messages()).some((m) => m.method === '_x.ai/interject')).toBe(false)
})

it.each([1, 2])(
  'does not confirm steering when the ACP v%i process exits before its reply',
  async (version) => {
    const f = await fixture(version, 'exit')
    const running = f.adapter.run(f.run)
    const done = running.then(
      () => undefined,
      (error: unknown) => error,
    )
    await Promise.race([f.ready.promise, running])
    const steer = f.steer()
    if (!steer) throw new Error('Steering was not registered')
    await expect(steer({ id: 'lost', prompt: 'Continue' })).rejects.toThrow(
      /exited|closed|disconnect/i,
    )
    expect(await done).toBeInstanceOf(Error)
    expect(f.steer()).toBeUndefined()
  },
)
