import { afterEach, expect, it } from 'vite-plus/test'
import { rm } from 'node:fs/promises'
import { grokLaunch } from './grok.js'
import { initializeAcp, openAcpConnection } from '../acp/acp-connection.js'
import { acpModels } from '../../catalogs/acp.js'
import { providerFixture } from '../shared/provider-fixture.js'
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
createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);frames.push(v);writeFileSync(process.env.TEST_RECORD,JSON.stringify(frames));
 if(v.method==='initialize')return send(v.id,{protocolVersion:1,authMethods:[{id:'cached_token',name:'Cached sign-in'},{id:'xai.api_key',name:'API key'}],agentCapabilities:{}});
 if(v.method==='session/new')return send(v.id,{sessionId:'s',models:{currentModelId:'grok-a',availableModels:[{modelId:'grok-a',name:'Grok A'}]},configOptions:[{id:'reasoning',category:'thought_level',name:'Reasoning',type:'select',currentValue:'high',options:[{value:'high',name:'High'}]}]});
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
