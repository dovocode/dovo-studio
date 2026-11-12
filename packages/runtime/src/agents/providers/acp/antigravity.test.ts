import { expect, it } from 'vite-plus/test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { builtInAgentPresets } from '@dovo/protocol'
import { AgentRegistry } from '../../configuration/registry.js'

it.skipIf(process.platform === 'win32')(
  'discovers models and runs the bundled configuration through an installed agy ACP executable',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-installed-agy-'))
    const executable = join(directory, 'agy')
    const record = join(directory, 'calls.json')
    const registry = new AgentRegistry()
    try {
      await writeFile(
        executable,
        `#!${process.execPath}
const {createInterface}=require('node:readline');
const {readFileSync,writeFileSync}=require('node:fs');
if(process.argv[2]==='--version'){console.log('1.5.1');process.exit(0)}
if(process.argv.slice(2).join(' ')!=='acp')process.exit(2);
const record=process.env.DOVO_AGY_FIXTURE_RECORD;
const calls=()=>{try{return JSON.parse(readFileSync(record,'utf8'))}catch{return []}};
const send=message=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\\n');
const respond=(id,result)=>send({id,result});
const configOptions=[{id:'model',name:'Model',type:'select',currentValue:'gemini-fixture',options:[{value:'gemini-fixture',name:'Gemini fixture'}]}];
createInterface({input:process.stdin}).on('line',line=>{
  const input=JSON.parse(line);writeFileSync(record,JSON.stringify([...calls(),{argv:process.argv.slice(2),method:input.method}]));
  if(input.method==='initialize')respond(input.id,{protocolVersion:1,agentInfo:{name:'antigravity-acp',version:'1.5.1'},agentCapabilities:{sessionCapabilities:{close:{}}}});
  if(input.method==='session/new')respond(input.id,{sessionId:'agy-session',configOptions});
  if(input.method==='session/set_config_option')respond(input.id,{configOptions});
  if(input.method==='session/prompt'){
    send({method:'session/update',params:{sessionId:'agy-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Antigravity fixture reply'}}}});
    respond(input.id,{stopReason:'end_turn'});
  }
  if(input.method==='session/close')respond(input.id,{});
});
`,
      )
      await chmod(executable, 0o700)
      const preset = builtInAgentPresets().find((agent) => agent.id === 'dovo:antigravity')!
      const agent = {
        ...preset,
        model: 'gemini-fixture',
        env: {
          PATH: directory + delimiter + (process.env.PATH ?? ''),
          DOVO_AGY_FIXTURE_RECORD: record,
        },
      }
      const adapter = await registry.get(agent.provider)
      expect((await adapter.models?.(agent))?.models).toEqual([
        { id: 'gemini-fixture', name: 'Gemini fixture' },
      ])
      const text: string[] = []
      const sessions: string[] = []
      await adapter.run({
        agent,
        cwd: directory,
        prompt: 'Reply from the fixture',
        signal: new AbortController().signal,
        onSession: (id) => sessions.push(id),
        onText: (chunk) => text.push(chunk),
        onActivity: () => {},
        approve: async () => 'deny',
        ask: async () => null,
      })
      expect(sessions).toEqual(['agy-session'])
      expect(text.join('')).toBe('Antigravity fixture reply')
      const calls: Array<{ argv: string[]; method: string }> = JSON.parse(
        await readFile(record, 'utf8'),
      )
      expect(calls.every((call) => JSON.stringify(call.argv) === '["acp"]')).toBe(true)
      expect(calls.map((call) => call.method)).toEqual([
        'initialize',
        'session/new',
        'session/close',
        'initialize',
        'session/new',
        'session/set_config_option',
        'session/prompt',
        'session/close',
      ])
    } finally {
      await registry.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
