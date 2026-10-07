import { afterEach, expect, it, vi } from 'vite-plus/test'
import { rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCopilotAdapter, copilotPermission, copilotExecutable } from './copilot.js'
import { providerFixture } from '../shared/provider-fixture.js'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const f = await providerFixture(
    'copilot',
    String.raw`
const {writeFileSync}=require('node:fs');let bytes=Buffer.alloc(0);const messages=[];
const send=value=>{const text=JSON.stringify({jsonrpc:'2.0',...value});process.stdout.write('Content-Length: '+Buffer.byteLength(text)+'\r\n\r\n'+text)};
const reply=(id,result)=>send({id,result});let sid='';let count=0;
const event=(type,data={},extra={})=>send({method:'session.event',params:{sessionId:sid,event:{id:'event-'+(++count),timestamp:new Date().toISOString(),type,data,...extra}}});
function handle(v){messages.push(v);writeFileSync(process.env.TEST_RECORD,JSON.stringify(messages));const p=v.params||{};
 if(!v.method&&v.id==='question'){event('session.idle');return}
 if(v.method==='connect'||v.method==='ping')return reply(v.id,{protocolVersion:3});
 if(v.method==='models.list')return reply(v.id,{models:[{id:'a',name:'A',supportedReasoningEfforts:['low','high']}]});
 if(v.method==='auth.getStatus')return reply(v.id,{isAuthenticated:true});
 if(v.method==='session.create'||v.method==='session.resume'){sid=p.sessionId||'session';return reply(v.id,{sessionId:sid})}
 if(v.method==='session.send'){
  reply(v.id,{messageId:'user'}); if(p.prompt==='hold')return;
  if(p.prompt==='disconnect')return setTimeout(()=>process.exit(0),10);
  if(p.prompt==='approval'){event('permission.requested',{requestId:'approval',permissionRequest:{kind:'shell',commands:['pwd'],canOfferSessionApproval:false}});return}
  if(p.prompt==='question'){send({id:'question',method:'userInput.request',params:{sessionId:sid,question:'Continue?',choices:['yes','no'],allowFreeform:true}});return}
  if(p.prompt==='fail'){event('session.error',{message:'Failed request'});return}
  event('assistant.message_delta',{messageId:'child',deltaContent:'HIDDEN'}, {agentId:'subagent'});
  event('assistant.message_delta',{messageId:'progress',deltaContent:'Working.'});event('assistant.message',{messageId:'progress',content:'Working.'});
  event('tool.execution_start',{toolCallId:'t',toolName:'read_file',arguments:{path:'file'}});event('tool.execution_complete',{toolCallId:'t',success:true});
  event('assistant.message_delta',{messageId:'final',deltaContent:'Done.'});event('assistant.message',{messageId:'final',content:'Done.'});event('session.idle');return;
 }
 if(v.method==='session.permissions.handlePendingPermissionRequest'||v.method==='session.ui.handlePendingUserInput'){reply(v.id,{});event('session.idle');return}
 if(v.method==='session.history.compact')return reply(v.id,{success:true});
 if(v.method==='session.delete')return reply(v.id,{success:true});
 if(v.method==='session.detach')return reply(v.id,{success:true});
 if(v.method==='shutdown'){reply(v.id,{});return}
 if(v.id!==undefined)reply(v.id,{});
}
process.stdin.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);for(;;){const index=bytes.indexOf('\r\n\r\n');if(index<0)return;const size=Number(/Content-Length:\s*(\d+)/i.exec(bytes.subarray(0,index).toString())[1]);if(bytes.length<index+4+size)return;const value=JSON.parse(bytes.subarray(index+4,index+4+size));bytes=bytes.subarray(index+4+size);handle(value)}});
process.stdin.on('end',()=>process.exit(0));`,
  )
  directories.push(f.cwd)
  return { ...f, adapter: createCopilotAdapter() }
}
it('streams SDK events with message boundaries, excludes child prose, and resumes sessions', async () => {
  const f = await fixture(),
    boundary = vi.fn<() => void>()
  await f.adapter.run({ ...f.run, onTextBoundary: boundary })
  expect(f.output.join('')).toBe('Working.Done.')
  expect(boundary).toHaveBeenCalledOnce()
  expect(f.sessions).toHaveLength(1)
  await f.adapter.run({ ...f.run, sessionId: f.sessions[0] })
  expect((await f.messages()).some((frame) => frame.method === 'session.resume')).toBe(true)
})
it('discovers models through the installed SDK', async () => {
  const f = await fixture()
  expect(await f.adapter.models?.(f.run.agent)).toMatchObject({
    models: [{ id: 'a', reasoning: [{ id: 'low' }, { id: 'high' }] }],
  })
})
it('fails the turn when recording an SDK event fails instead of letting the SDK swallow it', async () => {
  const f = await fixture()
  await expect(
    f.adapter.run({
      ...f.run,
      onEvent: () => {
        throw new Error('Could not record provider activity')
      },
    }),
  ).rejects.toThrow('Could not record provider activity')
})
it('ends an admitted turn if the SDK host disconnects', async () => {
  const f = await fixture()
  await expect(f.adapter.run({ ...f.run, prompt: 'disconnect' })).rejects.toThrow(
    /Copilot|CLI server|closed|disposed/i,
  )
}, 20000)
it('disables all tools for utilities and injects MCP only into coding sessions', async () => {
  const f = await fixture()
  await f.adapter.run({ ...f.run, tools: 'none', ephemeral: true })
  const wire = await f.messages()
  expect(wire.find((frame) => frame.method === 'session.create')?.params).toMatchObject({
    availableTools: [],
    excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
  })
  expect(wire.some((frame) => frame.method === 'session.delete')).toBe(true)
})
it('fails SDK turn errors and cancels admitted turns', async () => {
  const f = await fixture()
  await expect(f.adapter.run({ ...f.run, prompt: 'fail' })).rejects.toThrow('Failed request')
  const controller = new AbortController()
  await expect(
    f.adapter.run({
      ...f.run,
      prompt: 'hold',
      signal: controller.signal,
      onPromptAccepted: () => controller.abort(new Error('Stop')),
    }),
  ).rejects.toThrow('Stop')
  expect((await f.messages()).some((frame) => frame.method === 'session.abort')).toBe(true)
})
it('resolves installed commands on PATH and refuses workspace-write symlink escapes', async () => {
  const f = await fixture(),
    approve = vi.fn<() => Promise<boolean>>(async () => false)
  expect(await copilotExecutable(process.execPath, {}, f.cwd)).toBe(process.execPath)
  const outside = join(f.cwd, '..', `outside-${Date.now()}`)
  directories.push(outside)
  await writeFile(outside, 'x')
  const link = join(f.cwd, 'link')
  await symlink(outside, link)
  const permission = copilotPermission(
    { ...f.run, agent: { ...f.run.agent, permission: 'workspace-write' }, approve },
    f.run.signal,
  )
  expect(
    await permission(
      {
        kind: 'write',
        fileName: link,
        diff: 'change',
        intention: 'change file',
        canOfferSessionApproval: false,
        toolCallId: 't',
      },
      { sessionId: 's' },
    ),
  ).toMatchObject({ kind: 'reject' })
  expect(approve).toHaveBeenCalledOnce()
})

it('routes SDK approval and question callbacks to Dovo', async () => {
  const f = await fixture(),
    approve = vi.fn<() => Promise<boolean>>(async () => true)
  await f.adapter.run({ ...f.run, prompt: 'approval', approve })
  expect(approve).toHaveBeenCalledOnce()
  expect(
    (await f.messages()).find(
      (frame) => frame.method === 'session.permissions.handlePendingPermissionRequest',
    )?.params,
  ).toMatchObject({ result: { kind: 'approve-once' } })
  await f.adapter.run({ ...f.run, prompt: 'question' })
  expect((await f.messages()).find((frame) => frame.id === 'question')?.result).toMatchObject({
    answer: 'yes',
    wasFreeform: false,
  })
})
