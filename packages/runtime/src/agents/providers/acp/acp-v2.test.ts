/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vite-plus/test'
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
import { defaultTaskHarness, taskFamilyRunToken, toolPresentation } from '@dovo/protocol'
import { startRuntime } from '../../../index.js'
import { fixture as runtimeFixture } from '../../../testing/fixture.js'
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
const configOptions=[{configId:'model',type:'select',name:'Model',...(mode==='categoryless-model'?{}:{category:'model'}),currentValue:'a',options:[{value:'a',name:'A'},{value:'b',name:'B'}]},{configId:'mode',type:'select',name:'Mode',category:'mode',currentValue:'code',options:[{value:'code',name:'Code'},{value:'plan',name:'Plan'}]},{configId:'toggle',type:'boolean',name:'Toggle',currentValue:false}];
if(mode==='antigravity')Object.assign(configOptions[1],{currentValue:'yolo',options:['yolo','default','auto','plan'].map(value=>({value,name:value}))});
if(mode==='kiro')configOptions.push({configId:'autopilot',type:'select',name:'Autopilot',currentValue:'on',options:['on','off'].map(value=>({value,name:value}))});
if(mode==='categoryless-model')configOptions.push({configId:'thought',type:'select',name:'Effort',category:'thinking',currentValue:'low',options:[{value:'low',name:'Low'},{value:'high',name:'High'}]});
let pending;
const background=[{type:'terminal',terminalId:'background'}];
const cancelBackground=mode.startsWith('cancel-background');
const announce=()=>update({sessionUpdate:'terminal_update',terminalId:'background'});
const chunk=text=>update({sessionUpdate:'terminal_output_chunk',terminalId:'background',data:Buffer.from(text).toString('base64')});
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
else if(m.method==='session/resume'){update({sessionUpdate:'agent_message',messageId:'old',content:[{type:'text',text:'old history'}]});
if(mode==='busy-output') { announce(); chunk('Before snapshot. '); }
update({sessionUpdate:'state_update',state:mode.startsWith('busy')?'running':'idle',stopReason:'end_turn',...(mode==='busy-output'?{background}:{})});
if(mode==='busy-output') {
 update({sessionUpdate:'agent_message_chunk',messageId:'resumed',content:{type:'text',text:'Resumed '}});
 chunk('After snapshot. ');
 setTimeout(()=>{
   update({sessionUpdate:'agent_message',messageId:'resumed',content:[{type:'text',text:'Resumed answer'}]});
   update({sessionUpdate:'state_update',state:'idle',stopReason:'end_turn',background});
 },40);
}
if(mode==='resume-config-update'){
 update({sessionUpdate:'config_option_update',configOptions});
 reply(m.id,{});
}else reply(m.id,{configOptions});
if(mode==='busy-input') {
 send({id:'resumed-permission',method:'session/request_permission',params:{sessionId:'s',title:'Continue build',subject:{type:'command',command:'pnpm build',cwd:process.cwd()},options:[{optionId:'yes',name:'Allow',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'}]}})
}
if(mode==='busy')setTimeout(()=>update({sessionUpdate:'state_update',state:'idle',stopReason:'end_turn'}),40)}
else if(m.method==='session/set_config_option'){
 const option=configOptions.find(option=>option.configId===m.params.configId);
 if(option&&mode!=='ignore-config')option.currentValue=m.params.value;
 if(mode==='antigravity'&&m.params.configId==='model')configOptions[1].currentValue='yolo';
 reply(m.id,{configOptions});
}
else if(m.method==='session/prompt'){
 if(mode.startsWith('v1')){update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'v1 reply'}});reply(m.id,{stopReason:'end_turn'});return}
 if(cancelBackground) { announce(); chunk('Before Stop. '); update({sessionUpdate:'state_update',state:'running',background}); }
 if(mode==='cancel-background-held'){pending=m.id;return}
 update({sessionUpdate:'state_update',state:'running'});update({sessionUpdate:'user_message',messageId:'u',content:[]});reply(m.id,{messageId:'u'});
 if(mode==='hold'||mode==='stubborn'||mode==='cancel-background')return;
 if(mode==='stream-error'||mode==='stream-exit'){
   for(const text of ['first'.padEnd(1100,'x'),'last'])update({sessionUpdate:'terminal_output_chunk',terminalId:'t',data:Buffer.from(text).toString('base64')});
   if(mode==='stream-exit'){setTimeout(()=>process.exit(1),5);return}
   update({sessionUpdate:'state_update',state:'idle',stopReason:'error',error:{code:-32000,message:'Interrupted'}});return;
 }
 if(mode==='permission'){send({id:'p',method:'session/request_permission',params:{sessionId:'s',title:'Run build',subject:{type:'command',command:'pnpm build',cwd:process.cwd()},options:[{optionId:'yes',name:'Allow',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'}]}});return}
 if(mode==='form'){send({id:'form',method:'elicitation/create',params:{sessionId:'s',mode:'form',message:'Choose',requestedSchema:{type:'object',properties:{name:{type:'string',title:'Name'}},required:['name']}}});return}
 setTimeout(complete,40);
}else if(m.id==='resumed-permission'){
 send({id:'resumed-form',method:'elicitation/create',params:{sessionId:'s',mode:'form',message:'Choose',requestedSchema:{type:'object',properties:{name:{type:'string',title:'Name'}},required:['name']}}})
}else if(m.id==='resumed-form')update({sessionUpdate:'state_update',state:'idle',stopReason:'end_turn'});
else if(m.id==='p'||m.id==='form')complete();
else if(m.method==='session/cancel' && mode!=='stubborn'){
 if(pending){
  send({id:pending,error:{code:-32800,message:'Prompt withdrawn'}});
  setTimeout(()=>{update({sessionUpdate:'state_update',state:'idle',stopReason:'cancelled',background});chunk('After Stop.');},40);
  return;
 }
 update({sessionUpdate:'state_update',state:'idle',stopReason:'cancelled'});
 if(mode==='cancel-background') setTimeout(()=>chunk('After Stop.'),40);
}
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

async function withRuntime(
  f: Awaited<ReturnType<typeof fixture>>,
  check: (
    services: Awaited<ReturnType<typeof startRuntime>>['services'],
    taskId: string,
  ) => Promise<void>,
) {
  const workspace = await runtimeFixture()
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'acp-v2-lifecycle-fixture-owner-token',
    port: 0,
  })
  try {
    const services = runtime.services
    services.store.update(() => workspace.workspace)
    vi.spyOn(services.agents, 'get').mockResolvedValue({
      ...f.adapter,
      run: (run) => f.adapter.run({ ...run, acpLaunch: f.launch }),
    })
    const task = services.tasks.create({
      title: 'ACP v2 lifecycle',
      repositoryId: 'repo',
      agentId: '',
      objective: 'First prompt',
      harness: defaultTaskHarness('acp'),
    })
    await check(services, task.id)
  } finally {
    await f.adapter.dispose?.()
    await runtime.close()
    await workspace.cleanup()
  }
}

it('waits beyond the prompt acknowledgment, replaces messages, and reuses a v2 session', async () => {
  const f = await fixture()
  f.run.taskId = 'thread'
  let completed = false
  const accepted = new Promise<void>((resolve) => (f.run.onPromptAccepted = resolve))
  const running = f.adapter.run(f.run).then(() => {
    completed = true
  })
  await accepted
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

it.each(['stream-exit', 'stream-error'])(
  'retains the last terminal receipt after %s',
  async (mode) => {
    const f = await fixture(mode)
    await expect(f.adapter.run(f.run)).rejects.toBeInstanceOf(Error)
    const receipt = f.events.filter(({ name }) => name === 'tool_call_update').at(-1)
    expect(
      toolPresentation(JSON.stringify({ event: receipt?.value }), 'Agent terminal').output,
    ).toBe('first'.padEnd(1100, 'x') + 'last')
  },
)

it('confirms cancellation through idle before closing the owned process', async () => {
  const f = await fixture('hold')
  const controller = new AbortController()
  f.run.signal = controller.signal
  f.run.onPromptAccepted = () => controller.abort()
  await f.adapter.run(f.run)
  expect((await f.messages()).some((m) => m.method === 'session/cancel')).toBe(true)
})

it.each(['cancel-background', 'cancel-background-held'])(
  'keeps independent ACP v2 work running when Tasks cancels the foreground turn (%s)',
  async (mode) => {
    const f = await fixture(mode)
    await withRuntime(f, async (services, id) => {
      const { tasks, store } = services
      const { done } = await tasks.start(id)
      const cancelled = done.catch(() => undefined)
      await vi.waitFor(() =>
        expect(store.taskSummary(id).subagents?.[0]).toMatchObject({
          kind: 'background',
          status: 'working',
        }),
      )
      tasks.cancel(id)
      await cancelled
      expect(store.taskSummary(id).status).toBe('cancelled')
      await vi.waitFor(() =>
        expect(store.taskSummary(id).subagents?.[0]).toMatchObject({
          status: 'working',
          result: 'Before Stop. After Stop.',
        }),
      )
      expect((await f.messages()).map((message) => message.method)).toContain('session/cancel')
      expect((await f.messages()).map((message) => message.method)).not.toContain('session/close')
      await tasks.stopAgents(id, taskFamilyRunToken(store.get().tasks, id))
      expect((await f.messages()).map((message) => message.method)).toContain('session/close')
      expect(store.taskSummary(id).subagents?.[0].status).toBe('stopped')
    })
  },
)

it('saves live resume output on the earlier turn and keeps pre-snapshot history out', async () => {
  const f = await fixture('busy-output')
  await withRuntime(f, async ({ tasks, store }, id) => {
    await (
      await tasks.start(id)
    ).done
    const firstTurnId = store.task(id).turns?.at(-1)?.id
    await f.adapter.releaseTask?.(id)
    await (
      await tasks.start(id)
    ).done
    const task = store.task(id)
    const secondTurnId = task.turns?.at(-1)?.id
    expect(secondTurnId).not.toBe(firstTurnId)
    expect(task.messages.filter((message) => message.text.includes('Resumed'))).toEqual([
      expect.objectContaining({ role: 'assistant', turnId: firstTurnId, text: 'Resumed answer' }),
    ])
    expect(task.messages.some((message) => message.text.includes('old history'))).toBe(false)
    expect(
      task.messages.filter(
        (message) => message.turnId === secondTurnId && message.role === 'assistant',
      ),
    ).toEqual([expect.objectContaining({ text: 'Final answer' })])
    expect(task.subagents?.[0]).toMatchObject({
      kind: 'background',
      status: 'working',
      result: 'Before snapshot. After snapshot. ',
    })
  })
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
  f.run.agent.acpConfig = { mode: 'code', toggle: 'true' }
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
it('sets Antigravity ACP v2 permissions after a model switch and ignores a wider saved mode', async () => {
  const f = await fixture('antigravity')
  f.run.agent.acpInstallationId = 'antigravity-acp'
  f.run.agent.model = 'b'
  f.run.agent.acpMode = 'yolo'
  f.run.agent.acpConfig = { mode: 'auto' }
  f.run.agent.permission = 'ask'
  await f.adapter.run(f.run)
  expect(
    (await f.messages())
      .filter(({ method }) => method === 'session/set_config_option')
      .map(({ params }) => params),
  ).toEqual([
    { sessionId: 's', configId: 'model', type: 'id', value: 'b' },
    { sessionId: 's', configId: 'mode', type: 'id', value: 'default' },
  ])
})

it.each([
  { permission: 'ask', value: 'off' },
  { permission: 'auto', value: 'off' },
  { permission: 'full-access', value: 'on' },
] as const)(
  'applies Kiro Autopilot=$value for $permission independently of saved ACP options',
  async ({ permission, value }) => {
    const f = await fixture('kiro')
    f.run.agent.acpInstallationId = 'kiro'
    f.run.agent.args = [...(f.run.agent.args ?? []), '--agent-engine=v3']
    f.run.agent.permission = permission
    f.run.agent.acpConfig = { autopilot: value === 'on' ? 'off' : 'on' }
    await f.adapter.run(f.run)
    expect(
      (await f.messages())
        .filter(({ method }) => method === 'session/set_config_option')
        .map(({ params }) => params),
    ).toEqual([{ sessionId: 's', configId: 'autopilot', type: 'id', value }])
  },
)

it('discovers and uses a categoryless ACP v2 model with model-specific reasoning', async () => {
  const f = await fixture('categoryless-model')
  const catalog = await acpModels({ ...f.run.agent, provider: 'acp', model: 'b' }, f.launch)
  expect(catalog.models).toEqual([
    { id: 'a', name: 'A', isDefault: false },
    { id: 'b', name: 'B', isDefault: true, defaultReasoning: 'low' },
  ])
  await f.adapter.run({
    ...f.run,
    agent: {
      ...f.run.agent,
      model: 'b',
      reasoning: 'high',
      acpConfig: { model: 'a', thought: 'low' },
    },
  })
  expect(f.output.join('')).toBe('Final answer')
  expect(
    (await f.messages()).filter(({ method }) => method === 'session/set_config_option'),
  ).toEqual([
    expect.objectContaining({ params: expect.objectContaining({ configId: 'model', value: 'b' }) }),
    expect.objectContaining({
      params: expect.objectContaining({ configId: 'thought', value: 'high' }),
    }),
  ])
})

it('does not prompt when ACP v2 acknowledges a model change but keeps the old model', async () => {
  const f = await fixture('ignore-config')
  f.run.agent.model = 'b'
  await expect(f.adapter.run(f.run)).rejects.toThrow('ACP did not apply Model: b')
  expect((await f.messages()).map(({ method }) => method)).not.toContain('session/prompt')
})

it('discovers alternatives to unavailable ACP v2 settings', async () => {
  const f = await fixture()
  const catalog = await acpModels(
    {
      ...f.run.agent,
      model: 'removed',
      acpMode: 'removed',
      acpConfig: { missing: 'removed', toggle: 'removed' },
    },
    f.launch,
  )
  expect(catalog.models.map(({ id }) => id)).toEqual(['a', 'b'])
  expect(catalog.acp?.modes.map(({ id }) => id)).toEqual(['code', 'plan'])
  expect(
    (await f.messages()).filter(({ method }) => method === 'session/set_config_option'),
  ).toEqual([])
})

it('applies the selected model using the ACP v2 resume notification', async () => {
  const f = await fixture('resume-config-update')
  await f.adapter.run({ ...f.run, sessionId: 's', agent: { ...f.run.agent, model: 'b' } })
  expect(
    (await f.messages()).filter(({ method }) => method === 'session/set_config_option'),
  ).toEqual([
    expect.objectContaining({
      params: { sessionId: 's', configId: 'model', type: 'id', value: 'b' },
    }),
  ])
  expect(f.output.join('')).toBe('Final answer')
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

it.each(['ask', 'read-only'] as const)(
  'routes resumed foreground interactions under %s policy before sending the next prompt',
  async (permission) => {
    const f = await fixture('busy-input')
    f.run.sessionId = 's'
    f.run.agent.permission = permission
    const approvals: string[] = []
    f.run.approve = async (title) => {
      approvals.push(title)
      return 'approve'
    }
    f.run.ask = async () => ({ '0': ['Dominic'] })
    await f.adapter.run(f.run)
    const messages = await f.messages()
    expect(messages.find((m) => m.id === 'resumed-permission')?.result).toEqual({
      outcome: { outcome: 'selected', optionId: permission === 'ask' ? 'yes' : 'no' },
    })
    expect(approvals).toEqual(permission === 'ask' ? ['Continue build'] : [])
    expect(messages.find((m) => m.id === 'resumed-form')?.result).toEqual({
      action: 'accept',
      content: { name: 'Dominic' },
    })
    expect(messages.findIndex((m) => m.id === 'resumed-form')).toBeLessThan(
      messages.findIndex((m) => m.method === 'session/prompt'),
    )
    expect(f.output.join('')).toBe('Final answer')
  },
)

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

it('rejects tool-free image review before prompting a v2 agent without image capability', async () => {
  const f = await fixture()
  f.run.tools = 'none'
  f.run.attachments = [
    {
      id: 'image',
      name: 'shot.png',
      mime: 'image/png',
      size: 1,
      path: f.cwd + '/shot.png',
      data: 'AA==',
    },
  ]
  await expect(f.adapter.run(f.run)).rejects.toThrow('does not accept image input')
  expect((await f.messages()).some((message) => message.method === 'session/prompt')).toBe(false)
})
