import { decode, mcpServerSchema } from '@dovo/protocol'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { rm } from 'node:fs/promises'
import { createMuseAdapter } from './muse.js'
import { providerFixture } from '../shared/provider-fixture.js'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const f = await providerFixture(
    'muse',
    String.raw`
const {createInterface}=require('node:readline');const {writeFileSync}=require('node:fs');const messages=[];let cursor=0,turn='';
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');const reply=(id,result)=>send({id,result});
const event=(method,params={})=>send({method,params:{sessionId:'s',viewCursor:String(++cursor),sourceRange:{first:{line:cursor},last:{line:cursor},stream:{id:'s',kind:'session'}},...params}});
const item=(id,text,status='inProgress',revision=1,kind='agentMessage')=>({itemId:id,kind,turnId:turn,status,revision,text});
function finish(){event('item/started',{item:item('p','')});event('item/delta',{itemId:'p',delta:'Working.'});event('item/completed',{item:item('p','Working.','completed',2)});event('item/started',{item:item('f','')});event('item/delta',{itemId:'f',delta:'Done.'});event('item/completed',{item:item('f','Done.','completed',2)});event('turn/completed',{turnId:turn,terminal:'completed'})}
createInterface({input:process.stdin}).on('line',line=>{
 const v=JSON.parse(line),p=v.params||{};messages.push(v);writeFileSync(process.env.TEST_RECORD,JSON.stringify(messages));
 if(v.method==='initialize')return reply(v.id,{schema:{version:1,fingerprint:'test'},grantedCapabilities:process.env.NO_MCP?[]:['sessionMcp'],experimentalApi:false,sessionDurability:'durable',serverInfo:{name:'fixture',version:'1'},museHome:'/tmp/muse',platformFamily:'unix',platformOs:'macos',userAgent:'test'});
 if(v.method==='initialized')return;
 if(v.method==='model/list')return reply(v.id,{models:[{modelId:'a',providerId:'meta',displayLabel:'A',variants:['low','high'],defaultReasoningEffort:'low',isDefault:true,isActive:false}],providerId:'meta',profileId:null,source:'fakeCatalog'});
 if(v.method==='session/start'||v.method==='session/resume')return reply(v.id,{session:{sessionId:'s'},viewCursor:'0'});
 if(v.method==='turn/start'){
  turn=p.commandId;reply(v.id,{commandId:turn,status:'accepted',disposition:'started',startedNewTurn:true,turnId:turn});event('turn/started',{turnId:turn,commandId:turn});
  if(p.input[0].text==='hold')return;
  if(p.input[0].text==='disconnect')return setTimeout(()=>process.exit(0),10);
  if(p.input[0].text==='approval'){event('approval/requested',{approvalId:'approve',itemId:'tool',taskId:'task',toolCallId:'tool',judgeEscalated:false,protectedWrite:false,rawArgs:'pwd',currentRequirementId:'requirement',subject:{kind:'shell',command:'pwd'},availableChoices:[{choiceId:'once',decision:'approved',scope:'once',label:'Allow'},{choiceId:'deny',decision:'denied',scope:'once',label:'Deny'}]});return}
  if(p.input[0].text==='question'){event('userInput/requested',{userInputId:'question',itemId:'tool',toolCallId:'tool',toolName:'ask_user',turnId:turn,questions:[{id:'answer',header:'Question',question:'Continue?',options:[{label:'yes'},{label:'no'}],selection:{mode:'single'}}]});return}
  if(p.input[0].text==='fail'){event('turn/completed',{turnId:turn,terminal:'failed',error:{kind:'providerError',message:'Model failed',retryable:false}});return}
  finish();return;
 }
 if(v.method==='turn/steer'){reply(v.id,{commandId:p.commandId,status:'accepted',turnId:turn});finish();return}
 if(v.method==='approval/decide'||v.method==='userInput/answer'){reply(v.id,{commandId:p.commandId,status:'accepted'});finish();return}
 if(v.method==='session/compact'){reply(v.id,{commandId:p.commandId,status:'accepted'});event('item/completed',{item:{itemId:'compact',kind:'compaction',turnId:null,status:'completed',revision:1,outcome:'compacted'}});return}
 if(v.id!==undefined)reply(v.id,{commandId:p.commandId,status:'accepted'});
});`,
  )
  directories.push(f.cwd)
  return { ...f, adapter: createMuseAdapter() }
}
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
    reasoning: [{ id: 'low' }, { id: 'high' }],
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
it('refuses unsupported restricted tool-free execution', async () => {
  const f = await fixture()
  await expect(f.adapter.run({ ...f.run, tools: 'none' })).rejects.toThrow('tool-free')
})
it('settles the SDK turn on host EOF', async () => {
  const f = await fixture()
  await expect(f.adapter.run({ ...f.run, prompt: 'disconnect' })).rejects.toThrow(
    /closed|exited|hostExited|transportEof/,
  )
})

it('routes SDK approvals and native question commands', async () => {
  const f = await fixture(),
    approve = vi.fn<() => Promise<boolean>>(async () => true)
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
