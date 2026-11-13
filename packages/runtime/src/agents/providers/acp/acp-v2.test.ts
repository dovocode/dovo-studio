/// <reference types="node" />
import { afterEach, expect, it } from 'vite-plus/test'
import { rm } from 'node:fs/promises'
import { createAcpAdapter } from './acp.js'
import { providerFixture } from '../shared/provider-fixture.js'
import {
  inspectAcp,
  authenticateAcp,
  logoutAcp,
  listAcpSessions,
  deleteAcpSession,
} from './acp-connection.js'
import { acpModels } from '../../catalogs/acp.js'

const dirs: string[] = []
const adapters: ReturnType<typeof createAcpAdapter>[] = []
afterEach(async () => {
  await Promise.all(
    adapters.splice(0).map(async (adapter) => {
      await adapter.dispose?.()
    }),
  )
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function fixture(mode = 'normal') {
  const f = await providerFixture(
    'acp',
    String.raw`
const fs=require('node:fs'), readline=require('node:readline');const messages=[];
const mode=process.env.TEST_MODE;
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
const reply=(id,result)=>send({id,result});const update=update=>send({method:'session/update',params:{sessionId:'s',update}});
const configOptions=[{configId:'model',type:'select',name:'Model',category:'model',currentValue:'a',options:[{value:'a',name:'A'},{value:'b',name:'B'}]},{configId:'mode',type:'select',name:'Mode',category:'mode',currentValue:'code',options:[{value:'code',name:'Code'},{value:'plan',name:'Plan'}]},{configId:'toggle',type:'boolean',name:'Toggle',currentValue:false}];
let pending;
const complete=()=>{update({sessionUpdate:'agent_message_chunk',messageId:'a',content:{type:'text',text:'draft'}});update({sessionUpdate:'agent_message',messageId:'a',content:[{type:'text',text:'Final answer'}]});update({sessionUpdate:'state_update',state:'idle',stopReason:mode==='error'?'error':'end_turn',...(mode==='error'?{error:{code:-32000,message:'Provider failed after acceptance'}}:{})});};
readline.createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line);messages.push(m);fs.writeFileSync(process.env.TEST_RECORD,JSON.stringify(messages));
if(m.method==='initialize'){
 if(mode==='v1-error' && m.params.protocolVersion===2){send({id:m.id,error:{code:-32022,message:'Unsupported protocol version',data:{requested:2,supported:[1]}}});return}
 if(mode.startsWith('v1')){reply(m.id,{protocolVersion:1,agentCapabilities:{loadSession:true}});return}
 if(mode==='malformed'){reply(m.id,{protocolVersion:2});return}
 reply(m.id,{protocolVersion:2,info:{name:'fixture-v2',version:'1'},capabilities:{session:{delete:{},mcp:{stdio:{},http:{}}}},authMethods:[{type:'agent',methodId:'browser',name:'Browser'},{type:'agent',methodId:'cached_token',name:'Cached'},{type:'terminal',methodId:'terminal',name:'Terminal',args:['login'],env:[{name:'LOGIN_MODE',value:'interactive'}]}]});
}else if(m.method==='auth/login' && mode==='auth-error')send({id:m.id,error:{code:-32022,message:'Authentication failed',data:{supported:[1]}}});
else if(m.method==='session/new')reply(m.id,mode.startsWith('v1')?{sessionId:'s'}:{sessionId:'s',configOptions,availableCommands:[{type:'prompt',name:'compact',description:'Compact'}]});
else if(m.method==='session/resume'){update({sessionUpdate:'agent_message',messageId:'old',content:[{type:'text',text:'old history'}]});update({sessionUpdate:'state_update',state:mode==='busy'?'running':'idle',stopReason:'end_turn'});reply(m.id,{configOptions});if(mode==='busy')setTimeout(()=>update({sessionUpdate:'state_update',state:'idle',stopReason:'end_turn'}),40)}
else if(m.method==='session/set_config_option')reply(m.id,{configOptions});
else if(m.method==='session/prompt'){
 if(mode.startsWith('v1')){update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'v1 reply'}});reply(m.id,{stopReason:'end_turn'});return}
 update({sessionUpdate:'state_update',state:'running'});update({sessionUpdate:'user_message',messageId:'u',content:[]});reply(m.id,{messageId:'u'});
 if(mode==='hold'||mode==='stubborn')return;
 if(mode==='permission'){send({id:'p',method:'session/request_permission',params:{sessionId:'s',title:'Run build',subject:{type:'command',command:'pnpm build',cwd:process.cwd()},options:[{optionId:'yes',name:'Allow',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'}]}});return}
 if(mode==='form'){send({id:'form',method:'elicitation/create',params:{sessionId:'s',mode:'form',message:'Choose',requestedSchema:{type:'object',properties:{name:{type:'string',title:'Name'}},required:['name']}}});return}
 setTimeout(complete,40);
}else if(m.id==='p'||m.id==='form')complete();
else if(m.method==='session/cancel' && mode!=='stubborn')update({sessionUpdate:'state_update',state:'idle',stopReason:'cancelled'});
else if(m.method==='session/list')reply(m.id,{sessions:[{sessionId:'s',cwd:process.cwd()}]});
else if(m.id!==undefined)reply(m.id,{});
});
`,
  )
  dirs.push(f.cwd)
  f.run.agent.env = { ...f.run.agent.env, DOVO_ACP_V2: '1', TEST_MODE: mode }
  f.run.agent.model = ''
  const adapter = createAcpAdapter()
  adapters.push(adapter)
  return {
    ...f,
    adapter,
    launch: { command: process.execPath, args: [f.script], env: f.run.agent.env },
  }
}

it('waits beyond the prompt acknowledgment, replaces messages, and reuses a v2 session', async () => {
  const f = await fixture()
  f.run.taskId = 'thread'
  const accepted = Promise.withResolvers<void>()
  let completed = false
  f.run.onPromptAccepted = () => accepted.resolve()
  const running = f.adapter.run(f.run).then(() => {
    completed = true
  })
  await accepted.promise
  expect(completed).toBe(false)
  await running
  expect(f.output.join('')).toBe('Final answer')
  expect((await f.messages()).find((m) => m.method === 'initialize')?.params).toMatchObject({
    protocolVersion: 2,
    info: { name: 'dovo-studio' },
    capabilities: { elicitation: { form: {} } },
  })
  await f.adapter.run({ ...f.run, sessionId: 's' })
  expect((await f.messages()).filter((m) => m.method === 'session/new')).toHaveLength(1)
  expect(f.output.join('')).toBe('Final answerFinal answer')
})

it('keeps the accepted prompt failed if the agent later reports an error', async () => {
  const f = await fixture('error')
  await expect(f.adapter.run(f.run)).rejects.toThrow('Provider failed after acceptance')
  expect(f.output.join('')).toBe('Final answer')
})

it('confirms cancellation through idle before closing the owned process', async () => {
  const f = await fixture('hold')
  const controller = new AbortController()
  f.run.signal = controller.signal
  f.run.onPromptAccepted = () => controller.abort()
  await f.adapter.run(f.run)
  expect((await f.messages()).some((m) => m.method === 'session/cancel')).toBe(true)
})

it('resumes without duplicating retained history or completing from the initial idle snapshot', async () => {
  const f = await fixture()
  f.run.sessionId = 's'
  await f.adapter.run(f.run)
  expect(f.output.join('')).toBe('Final answer')
  expect((await f.messages()).some((m) => m.method === 'session/resume')).toBe(true)
})

it.each(['ask', 'read-only'] as const)(
  'applies %s policy to command permission subjects',
  async (permission) => {
    const f = await fixture('permission')
    f.run.agent.permission = permission
    const approvals: string[] = []
    f.run.approve = async (title) => {
      approvals.push(title)
      return 'approve'
    }
    await f.adapter.run(f.run)
    const response = (await f.messages()).find((m) => m.id === 'p')
    expect(response?.result).toEqual({
      outcome: { outcome: 'selected', optionId: permission === 'ask' ? 'yes' : 'no' },
    })
    expect(approvals).toEqual(permission === 'ask' ? ['Run build'] : [])
  },
)

it('dispatches native forms through the existing question flow', async () => {
  const f = await fixture('form')
  f.run.ask = async () => ({ '0': ['Dominic'] })
  await f.adapter.run(f.run)
  expect((await f.messages()).find((m) => m.id === 'form')?.result).toMatchObject({
    action: 'accept',
    content: { name: 'Dominic' },
  })
})

it('uses typed config IDs for model, mode, and boolean configuration', async () => {
  const f = await fixture()
  f.run.agent.model = 'b'
  f.run.agent.acpMode = 'plan'
  f.run.agent.acpConfig = { toggle: 'true' }
  await f.adapter.run(f.run)
  expect(
    (await f.messages())
      .filter((m) => m.method === 'session/set_config_option')
      .map((m) => m.params),
  ).toEqual([
    { sessionId: 's', configId: 'mode', type: 'id', value: 'plan' },
    { sessionId: 's', configId: 'model', type: 'id', value: 'b' },
    { sessionId: 's', configId: 'toggle', type: 'boolean', value: true },
  ])
})

it.each(['v1', 'v1-error'])(
  'falls back from %s only before session work, with a fresh v1 initialization',
  async (mode) => {
    const f = await fixture(mode)
    await f.adapter.run(f.run)
    expect(f.output.join('')).toBe('v1 reply')
    expect((await f.messages()).find((m) => m.method === 'initialize')?.params).toMatchObject({
      protocolVersion: 1,
      clientInfo: { name: 'dovo-studio' },
    })
  },
)

it('does not disguise a malformed v2 initialization as v1 compatibility', async () => {
  const f = await fixture('malformed')
  await expect(f.adapter.run(f.run)).rejects.toThrow(/info/)
  expect((await f.messages()).filter((m) => m.method === 'initialize')).toHaveLength(1)
  expect((await f.messages()).some((m) => m.method === 'session/new')).toBe(false)
})

it('supports v2 discovery, sign-in, logout, listing and deletion', async () => {
  const f = await fixture()
  const info = await inspectAcp(f.launch)
  expect(info.agentInfo?.name).toBe('fixture-v2')
  expect(info.authMethods.map((m) => m.id)).toEqual(['browser', 'cached_token', 'terminal'])
  expect(info.canLogout).toBe(true)
  expect(info.authMethods.find((method) => method.id === 'terminal')).toMatchObject({
    env: { LOGIN_MODE: 'interactive' },
  })
  await authenticateAcp(f.launch, 'browser')
  expect((await f.messages()).some((m) => m.method === 'auth/login')).toBe(true)
  await expect(authenticateAcp(f.launch, 'terminal')).rejects.toThrow('interactive terminal')
  await logoutAcp(f.launch)
  expect((await f.messages()).some((m) => m.method === 'auth/logout')).toBe(true)
  expect((await listAcpSessions(f.launch)).sessions[0].sessionId).toBe('s')
  await deleteAcpSession(f.launch, 's')
  const catalog = await acpModels(f.run.agent, f.launch)
  expect(catalog.models.map((m) => m.id)).toEqual(['a', 'b'])
  expect(catalog.acp?.modes.map((m) => m.id)).toEqual(['code', 'plan'])
})

it('keeps v2 disabled when the agent explicitly sets the rollout flag to zero', async () => {
  const f = await fixture('v1')
  f.run.agent.env = { ...f.run.agent.env, DOVO_ACP_V2: '0' }
  await f.adapter.run(f.run)
  expect((await f.messages()).find((m) => m.method === 'initialize')?.params?.protocolVersion).toBe(
    1,
  )
})

it('closes a stubborn owned agent if cancellation is not confirmed', async () => {
  const f = await fixture('stubborn')
  const controller = new AbortController()
  f.run.signal = controller.signal
  f.run.onPromptAccepted = () => controller.abort()
  await expect(f.adapter.run(f.run)).rejects.toThrow(/closed|exited/i)
  expect((await f.messages()).some((m) => m.method === 'session/cancel')).toBe(true)
})

it('waits for resumed foreground work before sending a new prompt', async () => {
  const f = await fixture('busy')
  f.run.sessionId = 's'
  const activities: string[] = []
  f.run.onActivity = (text) => activities.push(text)
  await f.adapter.run(f.run)
  expect(activities).toContain('Waiting for the existing ACP foreground work to finish')
  expect(f.output.join('')).toBe('Final answer')
})

it('deletes new temporary sessions after completing their work', async () => {
  const f = await fixture()
  f.run.ephemeral = true
  await f.adapter.run(f.run)
  const messages = await f.messages()
  expect(messages.filter((m) => m.method === 'session/delete').map((m) => m.params)).toEqual([
    { sessionId: 's' },
  ])
  expect(messages.findIndex((m) => m.method === 'session/close')).toBeLessThan(
    messages.findIndex((m) => m.method === 'session/delete'),
  )
})

it('never falls back after authentication has started', async () => {
  const f = await fixture('auth-error')
  f.run.acpLaunch = { ...f.launch, authentication: 'grok' }
  await expect(f.adapter.run(f.run)).rejects.toThrow('Authentication failed')
  const messages = await f.messages()
  expect(messages.filter((m) => m.method === 'initialize')).toHaveLength(1)
  expect(messages.some((m) => m.method === 'session/new')).toBe(false)
})

it('retains a negotiated v1 warm session while the v2 rollout flag stays enabled', async () => {
  const f = await fixture('v1')
  f.run.taskId = 'warm-fallback'
  await f.adapter.run(f.run)
  await f.adapter.run({ ...f.run, sessionId: 's' })
  const messages = await f.messages()
  expect(messages.filter((m) => m.method === 'initialize')).toHaveLength(1)
  expect(messages.filter((m) => m.method === 'session/prompt')).toHaveLength(2)
  expect(f.output.join('')).toBe('v1 replyv1 reply')
})
