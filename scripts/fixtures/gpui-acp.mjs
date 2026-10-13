// Private runtime with a deterministic ACP process. No registry network or real provider is used.
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../../packages/runtime/dist/index.js'
const root = process.env.DOVO_DATA_ROOT
if (!root) throw new Error('DOVO_DATA_ROOT is required')
await mkdir(root, { recursive: true })
const script = join(root, 'private-acp.cjs')
await writeFile(
  script,
  `
const {createInterface}=require('node:readline');const {createServer}=require('node:http');const {writeFileSync,readFileSync,existsSync}=require('node:fs');
const root=process.env.PRIVATE_ACP_ROOT;let callback;
const record=(name,value)=>writeFileSync(root+'/'+name+'.json',JSON.stringify(value));
const reply=(input,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:input.id,result})+'\\n');
if(process.argv.includes('--login')){console.log('Private ACP sign-in terminal ready');process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{if(data.includes('login')){record('signed-in',{method:'terminal'});console.log('Terminal authentication completed');process.exit(0)}});}
else createInterface({input:process.stdin}).on('line',line=>{
 const input=JSON.parse(line);
 if(input.method==='initialize')reply(input,{protocolVersion:1,agentInfo:{name:'Private ACP',version:'1.0.0'},agentCapabilities:{auth:{logout:{}},sessionCapabilities:{list:{},delete:{},close:{}}},authMethods:[{id:'browser',name:'Private browser sign-in'},{id:'terminal',name:'Private terminal sign-in',type:'terminal',args:['--login']}]});
 else if(input.method==='authenticate'){
  callback=createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.searchParams.get('code')==='fixture-code'&&url.searchParams.get('state')==='fixture-state'){record('signed-in',{method:'browser'});res.end('Authenticated');reply(input,{});callback.close();}else{res.statusCode=400;res.end('Invalid callback')}});
  callback.listen(0,'127.0.0.1',()=>{const redirect='http://127.0.0.1:'+callback.address().port+'/callback';process.stderr.write('Open https://fixture.invalid/login?state=fixture-state&redirect_uri='+encodeURIComponent(redirect)+'\\n');record('callback',{url:redirect+'?code=fixture-code&state=fixture-state'});});
 }
 else if(input.method==='logout'){record('signed-in',{method:'logged-out'});reply(input,{});}
 else if(input.method==='session/list'){
  const deleted=existsSync(root+'/deleted.json')?JSON.parse(readFileSync(root+'/deleted.json','utf8')).sessionId:null;
  const sessions=(input.params.cursor?['overlap','last']:['first','overlap']).filter(id=>id!==deleted).map(id=>({sessionId:id,title:'Saved session '+id,cwd:root,updatedAt:'2026-10-13T00:00:00Z'}));
  reply(input,{sessions,...(!input.params.cursor?{nextCursor:'next'}:{})});
 }
 else if(input.method==='session/delete'){record('deleted',input.params);reply(input,{});}
 else if(input.method==='session/new')reply(input,{sessionId:'discovery',configOptions:[{id:'model',name:'Model',category:'model',type:'select',currentValue:'private-model',options:[{value:'private-model',name:'Private model'}]}]});
 else if(input.method==='session/close')reply(input,{});
 else reply(input,{});
});
`,
)
const token = randomBytes(32).toString('hex')
const runtime = await startRuntime({
  databasePath: join(root, 'runtime.sqlite'),
  ownerToken: token,
  host: '127.0.0.1',
  port: 0,
})
process.once('SIGTERM', async () => {
  await runtime.close()
  process.exit(0)
})
process.once('SIGINT', async () => {
  await runtime.close()
  process.exit(0)
})
const s = runtime.services
const installations = []
const entry = {
  id: 'private-agent',
  name: 'Private ACP agent',
  version: '1.0.0',
  description: 'Deterministic local ACP fixture',
  distribution: 'binary',
  available: true,
}
s.acpInstallations.list = () => installations.map((item) => ({ ...item }))
s.acpInstallations.registry = async () => ({
  version: '1',
  agents: [
    entry,
    { ...entry, id: 'unavailable-agent', name: 'Unavailable agent', available: false },
  ],
  installations: s.acpInstallations.list(),
})
s.acpInstallations.install = async (registryId) => {
  if (registryId !== entry.id) throw new Error('Fixture installation is unavailable')
  const item = {
    id: entry.id,
    registryId: entry.id,
    name: entry.name,
    version: entry.version,
    distribution: entry.distribution,
    installedAt: new Date().toISOString(),
  }
  installations.splice(0, installations.length, item)
  await writeFile(join(root, 'installed.json'), JSON.stringify(item))
  return item
}
s.acpInstallations.remove = async (id) => {
  if (id !== entry.id) throw new Error('Unknown fixture installation')
  installations.splice(0)
  await writeFile(join(root, 'removed.json'), '{}')
}
s.acpInstallations.launch = (id) => {
  if (!installations.some((i) => i.id === id)) throw new Error('Install fixture first')
  return { command: process.execPath, args: [script], env: { PRIVATE_ACP_ROOT: root } }
}
s.store.update((workspace) => ({ ...workspace, agents: [], tasks: [], repositories: [] }))
await writeFile(join(root, 'fixture.json'), JSON.stringify({ installationId: entry.id }))
await writeFile(
  join(root, 'runtime-connection.pending'),
  JSON.stringify({ address: 'http://127.0.0.1:' + runtime.port, token }),
  { mode: 0o600 },
)
await rename(join(root, 'runtime-connection.pending'), join(root, 'runtime-connection.json'))
