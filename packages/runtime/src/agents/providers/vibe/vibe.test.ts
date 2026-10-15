/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { rm } from 'node:fs/promises'
import { createVibeAdapter, vibeSessionOptions } from './vibe.js'
import { patchVibeEntry } from './vibe-protocol.js'
import { providerFixture } from '../shared/provider-fixture.js'
import type { AgentRun } from '../../execution/types.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
// Wire shapes taken from Mistral Vibe v2.26.1's released app_server protocol/models.
async function fixture() {
  const f = await providerFixture(
    'vibe',
    String.raw`
const {writeFileSync,renameSync}=require('node:fs');const messages=[];
// Shutdown may interrupt a recording write; publish only complete snapshots.
const record=()=>{const path=process.env.TEST_RECORD;writeFileSync(path+'.tmp',JSON.stringify(messages));renameSync(path+'.tmp',path)};
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
const reply=(id,result)=>send({id,result});
let initialized=false;
let sid='vibe-session',tid='turn-1',options={},prompt='';
const event=(method,params)=>send({method,params:{sessionId:sid,eventId:1,...params}});
const entry=(id,type,rest={})=>({id,type,sessionId:sid,turnId:tid,generationStatus:'in_progress',...rest});
const added=e=>event('history/entryAdded',{turnId:tid,entry:e});
const done=(status='completed',extra={})=>{event('session/statsUpdated',{stats:{lastTurnPromptTokens:120,lastTurnCompletionTokens:20,lastTurnCachedTokens:30,contextTokens:90},contextWindow:200000});event('turn/completed',{turn:{id:tid,status,...extra}})};
const config={activeModel:{alias:'devstral'},models:[{alias:'devstral',displayName:'Devstral',thinking:'high',thinkingLevels:['off','high']}]};
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const v=JSON.parse(line);messages.push(v);record();const p=v.params||{};
 if(!v.method)return;
 if(v.method==='initialize')return reply(v.id,{serverInfo:{name:'vibe-app-server',version:'2.26.1'}});
 if(v.method==='initialized'){initialized=true;return}
 if(!initialized)return send({id:v.id,error:{code:-32002,message:'initialize must be the first request'}});
 if(v.method==='setup/status')return reply(v.id,{hasApiKey:process.env.TEST_AUTH!=='missing'});
 if(v.method==='config/read')return reply(v.id,{config});
 if(v.method==='session/start'||v.method==='session/resume'){
  options=p.agentConfig;sid=p.sessionId||sid;
  event('history/entryAdded',{entry:entry('old','message',{turnId:'old-turn',role:'assistant',content:[{type:'text',text:'HIDDEN OLD'}]})});
  return reply(v.id,{state:{session:{id:sid}}});
 }
 if(v.method==='config/write')return reply(v.id,{status:'applied',failures:[]});
 if(v.method==='config/effective/read')return reply(v.id,{config:{bypass_tool_permissions:process.env.TEST_POLICY==='bad'?true:options.autoApprove,disabled_tools:options.disabledTools,enabled_tools:options.enabledTools}});
 if(v.method==='stats/read')return reply(v.id,{stats:{lastTurnPromptTokens:120,lastTurnCompletionTokens:20,lastTurnCachedTokens:30,contextTokens:90},contextWindow:200000});
 if(v.method==='session/compact')return reply(v.id,{summary:'Compacted',state:{session:{id:sid}}});
 if(v.method==='turn/start'){
  prompt=p.message[0].text;
  if(prompt==='disconnect')return process.exit(2);
  if(prompt==='early'){
   added(entry('answer','message',{role:'assistant',content:[{type:'text',text:'Early reply'}]}));done();return reply(v.id,{turn:{id:tid,status:'in_progress'}});
  }
  reply(v.id,{turn:{id:tid,status:'in_progress'}});
  if(prompt==='hold')return;
  if(prompt==='fail')return done('failed',{error:{message:'Invalid API key'}});
  if(prompt==='limit')return done('completed',{stopReason:'limit'});
  if(prompt==='malformed')return event('history/entryUpdated',{turnId:tid,entryId:'missing',patch:[]});
  if(prompt==='approval'||prompt==='question'){
   const detail=prompt==='approval'?{kind:'approval',effect:{kind:'shell',toolName:'bash',input:{command:'pwd'}},choices:['approve','deny']}
    :{kind:'user_input',request:{questions:[{question:'Continue?',header:'Next',options:[{label:'yes',description:''},{label:'no',description:''}]}]}};
   send({id:'callback',method:'callback/call',params:{callback:entry('callback','callback',{callbackId:'cb-1',title:'Run command',detail})}});return;
  }
  // Child and retired-turn events cannot complete or contaminate the root response.
  event('history/entryAdded',{sessionId:'child',entry:entry('child-answer','message',{sessionId:'child',role:'assistant',content:[{type:'text',text:'HIDDEN CHILD'}]})});
  event('turn/completed',{turn:{id:'old-turn',status:'failed'}});
  added(entry('answer','message',{role:'assistant',content:[{type:'text',text:'Hel'}]}));
  event('history/entryUpdated',{turnId:tid,entryId:'answer',patch:[{op:'append',path:'/content/0/text',value:'lo'}]});
  event('history/entryUpdated',{turnId:tid,entryId:'answer',patch:[{op:'replace',path:'/content/0/text',value:'Hello!'}]});
  added(entry('reason','reasoning',{text:'Thinking'}));
  added(entry('tool','effect',{title:'Read file',detail:{kind:'file_read',toolName:'read_file',input:{path:'file.ts'}},state:{status:'running'}}));
  event('history/entryUpdated',{turnId:tid,entryId:'tool',patch:[{op:'replace',path:'/state',value:{status:'completed',outputText:'contents'}}]});
  done();return;
 }
 if(v.method==='callback/result'){
  if(!messages.some(message=>message.id==='callback' && message.result?.accepted===true))return done('failed',{error:{message:'Callback result arrived before delivery acknowledgement'}});
  reply(v.id,{accepted:true});done();return
 }
 if(v.method==='turn/steer'){reply(v.id,{accepted:true});done();return}
 if(v.method==='turn/interrupt'){reply(v.id,{accepted:true});done('interrupted');return}
 if(v.id!==undefined)reply(v.id,{});
});
process.stdin.on('end',()=>process.exit(0));`,
  )
  directories.push(f.cwd)
  return { ...f, adapter: createVibeAdapter() }
}
it('streams appended and canonical text, exposes effects and reasoning, and filters child/retired events', async () => {
  const f = await fixture()
  const accepted = vi.fn<() => void>()
  await f.adapter.run({ ...f.run, onPromptAccepted: accepted })
  expect(f.output.join('')).toBe('Hello!')
  expect(f.sessions).toEqual(['vibe-session'])
  expect(accepted).toHaveBeenCalledOnce()
  expect(f.events.filter((e) => e.name === 'vibe/effect')).toHaveLength(2)
  expect(f.events.some((e) => e.name === 'vibe/reasoning')).toBe(true)
  expect(f.events.find((e) => e.name === 'vibe/usage')?.value).toMatchObject({
    contextWindow: 200000,
  })
})
it('admits events sent before the turn acknowledgement without losing completion', async () => {
  const f = await fixture()
  await f.adapter.run({ ...f.run, prompt: 'early' })
  expect(f.output.join('')).toBe('Early reply')
})
it('resumes the saved session and applies model/reasoning only to the session override layer', async () => {
  const f = await fixture()
  await f.adapter.run({
    ...f.run,
    sessionId: 'saved',
    agent: { ...f.run.agent, model: 'custom/model', reasoning: 'high', instructions: 'Be precise' },
  })
  const messages = await f.messages()
  expect(messages.find((m) => m.method === 'session/resume')?.params).toMatchObject({
    sessionId: 'saved',
    agentConfig: { cwd: f.cwd, agent: 'ask', autoApprove: false },
  })
  expect(messages.find((m) => m.method === 'config/write')?.params?.ops).toEqual(
    expect.arrayContaining([
      { op: 'set', path: '/active_model', value: 'custom/model', targetLayer: 'overrides' },
      {
        op: 'set',
        path: '/models/custom~1model/thinking',
        value: 'high',
        targetLayer: 'overrides',
      },
    ]),
  )
  expect(messages.find((m) => m.method === 'session/context/inject')?.params).toMatchObject({
    input: [{ type: 'text', text: 'Be precise' }],
  })
})
it.each(['approve', 'deny'] as const)(
  'returns %s through the separate approval callback result',
  async (decision) => {
    const f = await fixture()
    const approve = vi.fn<AgentRun['approve']>().mockResolvedValue(decision)
    await f.adapter.run({ ...f.run, prompt: 'approval', approve })
    expect(approve).toHaveBeenCalledOnce()
    const frames = await f.messages()
    expect(frames.find((m) => m.method === 'callback/result')?.params).toMatchObject({
      sessionId: 'vibe-session',
      result: { callbackId: 'cb-1', output: { type: 'approval', decision: { type: decision } } },
    })
    expect(frames.findIndex((m) => m.id === 'callback')).toBeLessThan(
      frames.findIndex((m) => m.method === 'callback/result'),
    )
    expect(frames.find((m) => m.id === 'callback')?.result).toEqual({
      callbackId: 'cb-1',
      accepted: true,
    })
  },
)
it('acknowledges delivery before an automatic full-access approval', async () => {
  const f = await fixture()
  const approve = vi.fn<AgentRun['approve']>()
  await f.adapter.run({
    ...f.run,
    prompt: 'approval',
    approve,
    agent: { ...f.run.agent, permission: 'full-access' },
  })
  expect(approve).not.toHaveBeenCalled()
  const frames = await f.messages()
  expect(frames.findIndex((m) => m.id === 'callback')).toBeLessThan(
    frames.findIndex((m) => m.method === 'callback/result'),
  )
  expect(frames.find((m) => m.method === 'callback/result')?.params).toMatchObject({
    result: { output: { decision: { type: 'approve' } } },
  })
})
it('denies write/execute callbacks in read-only sessions even if the host asks', async () => {
  const f = await fixture(),
    approve = vi.fn<AgentRun['approve']>()
  await f.adapter.run({
    ...f.run,
    prompt: 'approval',
    approve,
    agent: { ...f.run.agent, permission: 'read-only' },
  })
  expect(approve).not.toHaveBeenCalled()
  expect((await f.messages()).find((m) => m.method === 'callback/result')?.params).toMatchObject({
    result: { output: { decision: { type: 'deny' } } },
  })
})
it.each([false, true])('maps structured questions and cancellation (%s)', async (cancelled) => {
  const f = await fixture()
  const ask = vi.fn<AgentRun['ask']>().mockResolvedValue(cancelled ? null : { '0': ['yes'] })
  await f.adapter.run({ ...f.run, prompt: 'question', ask })
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      questions: [expect.objectContaining({ id: '0', question: 'Continue?', custom: true })],
    }),
    f.run.signal,
  )
  expect((await f.messages()).find((m) => m.method === 'callback/result')?.params).toMatchObject({
    result: {
      output: {
        type: 'user_input',
        result: {
          cancelled,
          answers: cancelled ? [] : [{ question: 'Continue?', answer: 'yes', isOther: false }],
        },
      },
    },
  })
})
it('discovers configured model aliases and reasoning levels without opening a session', async () => {
  const f = await fixture()
  expect(await f.adapter.models?.(f.run.agent)).toMatchObject({
    models: [{ id: 'devstral', isDefault: true, reasoning: [{ id: 'off' }, { id: 'high' }] }],
  })
  expect((await f.messages()).some((m) => m.method === 'session/start')).toBe(false)
  expect(await f.adapter.probe(f.run.agent)).toMatchObject({ provider: 'vibe', available: true })
  expect(
    await f.adapter.probe({ ...f.run.agent, env: { ...f.run.agent.env, TEST_AUTH: 'missing' } }),
  ).toMatchObject({ available: false })
})
it('rejects an unavailable executable without hanging', async () => {
  const f = await fixture()
  await expect(
    f.adapter.run({ ...f.run, agent: { ...f.run.agent, endpoint: '/missing/vibe-app-server' } }),
  ).rejects.toThrow('ENOENT')
})
it.each([
  ['fail', 'Invalid API key'],
  ['limit', 'Vibe turn limit'],
  ['disconnect', 'Vibe'],
  ['malformed', 'unknown history entry'],
])('fails explicitly on %s', async (prompt, error) => {
  const f = await fixture()
  await expect(f.adapter.run({ ...f.run, prompt })).rejects.toThrow(error)
})
it('fails before submitting a prompt when native access settings are not applied', async () => {
  const f = await fixture()
  await expect(
    f.adapter.run({
      ...f.run,
      agent: { ...f.run.agent, env: { ...f.run.agent.env, TEST_POLICY: 'bad' } },
    }),
  ).rejects.toThrow('approval policy')
  expect((await f.messages()).some((m) => m.method === 'turn/start')).toBe(false)
})
it('uses native compaction without submitting a model prompt', async () => {
  const f = await fixture()
  await f.adapter.run({ ...f.run, sessionId: 'saved', compact: true })
  const frames = await f.messages()
  expect(frames.some((m) => m.method === 'session/compact')).toBe(true)
  expect(frames.some((m) => m.method === 'turn/start')).toBe(false)
})
it('steers the acknowledged active turn and retires its steering callback', async () => {
  const f = await fixture(),
    steer = vi.fn<NonNullable<AgentRun['onSteer']>>()
  steer.mockImplementation((send) => {
    if (send) void send({ id: 'steered', prompt: 'next' })
  })
  await f.adapter.run({ ...f.run, prompt: 'hold', onSteer: steer })
  expect((await f.messages()).find((m) => m.method === 'turn/steer')?.params).toMatchObject({
    expectedTurnId: 'turn-1',
    clientUserMessageId: 'steered',
    message: [{ type: 'text', text: 'next' }],
  })
  expect(steer).toHaveBeenLastCalledWith(undefined)
})
it('interrupts cancellation and drains the owned process', async () => {
  const f = await fixture(),
    controller = new AbortController()
  await expect(
    f.adapter.run({
      ...f.run,
      prompt: 'hold',
      signal: controller.signal,
      onPromptAccepted: () => controller.abort(new Error('cancelled')),
    }),
  ).rejects.toThrow('cancelled')
  expect((await f.messages()).some((m) => m.method === 'turn/interrupt')).toBe(true)
})
it('enforces utility and read-only tool boundaries and maps native access modes', async () => {
  const f = await fixture()
  expect(
    vibeSessionOptions({ ...f.run, agent: { ...f.run.agent, permission: 'read-only' } }),
  ).toMatchObject({
    agent: 'plan',
    enabledTools: ['read_file', 'grep', 'skill', 'ask_user_question'],
  })
  expect(
    vibeSessionOptions({ ...f.run, agent: { ...f.run.agent, permission: 'workspace-write' } }),
  ).toMatchObject({ agent: 'accept-edits', autoApprove: false })
  expect(
    vibeSessionOptions({ ...f.run, agent: { ...f.run.agent, permission: 'full-access' } }),
  ).toMatchObject({ agent: 'auto-approve', autoApprove: true })
  await expect(f.adapter.run({ ...f.run, tools: 'none' })).rejects.toThrow('tool-free')
  expect(await f.messages()).toEqual([])
})
it('applies Vibe append plus standard patches without modifying the original or allowing prototype pollution', () => {
  const original = { content: [{ text: 'a' }], state: { status: 'running' } }
  expect(
    patchVibeEntry(original, [
      { op: 'append', path: '/content/0/text', value: 'b' },
      { op: 'replace', path: '/state/status', value: 'completed' },
    ]),
  ).toEqual({ content: [{ text: 'ab' }], state: { status: 'completed' } })
  expect(original.content[0].text).toBe('a')
  expect(() =>
    patchVibeEntry(original, [{ op: 'add', path: '/__proto__/polluted', value: true }]),
  ).toThrow('__proto__')
  expect(() => patchVibeEntry(original, [{ op: 'append', path: '/state', value: 'b' }])).toThrow(
    'invalid string append',
  )
})
