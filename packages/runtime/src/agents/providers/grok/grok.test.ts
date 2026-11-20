import { afterEach, expect, it } from 'vite-plus/test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createGrokAdapter, grokLaunch } from './grok.js'
import { initializeAcp, openAcpConnection } from '../acp/acp-connection.js'
import { acpModels } from '../../catalogs/acp.js'
import { providerFixture } from '../shared/provider-fixture.js'
import { createAcpAdapter } from '../acp/acp.js'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const f = await providerFixture(
    'grok',
    String.raw`
const {createInterface}=require('node:readline');const {writeFileSync}=require('node:fs');const frames=[];
const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
let pendingPrompt;
createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);frames.push({...v,argv:process.argv.slice(2)});writeFileSync(process.env.TEST_RECORD,JSON.stringify(frames));
 if(v.method==='initialize')return send(v.id,{protocolVersion:1,authMethods:[{id:'cached_token',name:'Cached sign-in'},{id:'xai.api_key',name:'API key'}],agentCapabilities:{}});
 if(v.method==='session/new')return send(v.id,{sessionId:'s',models:{currentModelId:'grok-a',availableModels:[{modelId:'grok-a',name:'Grok A'}]},configOptions:[{id:'reasoning',category:'thought_level',name:'Reasoning',type:'select',currentValue:'high',options:[{value:'high',name:'High'}]}]});
 if(v.method==='session/prompt'){pendingPrompt=v.id;process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'approval',method:'session/request_permission',params:{sessionId:'s',toolCall:{toolCallId:'tool',kind:process.env.GROK_PERMISSION_TEST_KIND||'read',title:'Native review'},options:[{optionId:'yes',name:'Allow',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'}]}})+'\n');return}
 if(v.id==='approval')return send(pendingPrompt,{stopReason:'end_turn'});
 send(v.id,{});
});`,
  )
  directories.push(f.cwd)
  const launch = {
    command: process.execPath,
    args: [f.script],
    env: f.run.agent.env ?? {},
    authentication: 'grok' as const,
  }
  return { ...f, launch }
}
it('launches the isolated official Grok Build ACP host without auto updates', async () => {
  const f = await fixture()
  expect(
    grokLaunch({ ...f.run.agent, endpoint: '/bin/grok', args: ['--model', 'grok-a'] }),
  ).toMatchObject({
    command: '/bin/grok',
    args: ['--no-auto-update', 'agent', '--no-leader', 'stdio', '--model', 'grok-a'],
    authentication: 'grok',
  })
})
it('sets the launch permission from the thread and removes conflicting saved flags', async () => {
  const f = await fixture()
  const agent = {
    ...f.run.agent,
    args: [
      '--permission-mode=auto',
      '--permission-mode',
      'default',
      '--always-approve',
      '--model',
      'grok-a',
    ],
  }
  expect(grokLaunch(agent, 'ask').args).toEqual([
    '--no-auto-update',
    '--permission-mode',
    'default',
    'agent',
    '--no-leader',
    'stdio',
    '--model',
    'grok-a',
  ])
  expect(grokLaunch(agent, 'auto').args).toContain('auto')
  expect(grokLaunch(agent, 'full-access').args).toContain('--always-approve')
})
it('asks the user about a request Grok sends after its native Auto review', async () => {
  const f = await fixture()
  const adapter = createAcpAdapter()
  const titles: string[] = []
  await adapter.run({
    ...f.run,
    acpLaunch: f.launch,
    agent: { ...f.run.agent, permission: 'auto' },
    approve: async (title) => {
      titles.push(title)
      return 'deny'
    },
  })
  expect(titles).toEqual(['Native review'])
  expect((await f.messages()).find(({ id }) => id === 'approval')?.result).toEqual({
    outcome: { outcome: 'selected', optionId: 'no' },
  })
})
it.skipIf(process.platform === 'win32')(
  'runs a legacy Auto-accept edits setting as Supervised through the installed Grok executable',
  async () => {
    const f = await fixture()
    const executable = join(f.cwd, 'grok')
    await writeFile(executable, `#!${process.execPath}\n${await readFile(f.script, 'utf8')}`, {
      mode: 0o700,
    })
    const approvalTitles: string[] = []
    await createGrokAdapter().run({
      ...f.run,
      agent: {
        ...f.run.agent,
        endpoint: executable,
        permission: 'workspace-write',
        args: ['--always-approve'],
        env: { ...f.run.agent.env, GROK_PERMISSION_TEST_KIND: 'edit' },
      },
      approve: async (title) => {
        approvalTitles.push(title)
        return 'deny'
      },
    })
    expect((await f.messages())[0]).toMatchObject({
      argv: ['--no-auto-update', '--permission-mode', 'default', 'agent', '--no-leader', 'stdio'],
    })
    expect(approvalTitles).toEqual(['Native review'])
  },
)
it('authenticates headlessly with cached sign-in and reads legacy models plus reasoning', async () => {
  const f = await fixture(),
    catalog = await acpModels(f.run.agent, f.launch)
  expect(catalog).toMatchObject({
    models: [{ id: 'grok-a', name: 'Grok A' }],
    reasoning: [{ id: 'high', name: 'High' }],
  })
  expect((await f.messages()).find((frame) => frame.method === 'authenticate')?.params).toEqual({
    methodId: 'cached_token',
    _meta: { headless: true },
  })
})
it('prefers advertised API-key authentication when an explicit key is supplied', async () => {
  const f = await fixture()
  const connection = openAcpConnection(
    { ...f.launch, env: { ...f.launch.env, XAI_API_KEY: 'fixture-key' } },
    { requestPermission: () => ({ outcome: { outcome: 'cancelled' } }), sessionUpdate: () => {} },
  )
  try {
    await initializeAcp(connection)
    expect(
      (await f.messages()).find((frame) => frame.method === 'authenticate')?.params?.methodId,
    ).toBe('xai.api_key')
  } finally {
    await connection.close()
  }
})
