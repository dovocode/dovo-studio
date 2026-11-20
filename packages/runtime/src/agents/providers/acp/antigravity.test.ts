import { expect, it } from 'vite-plus/test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { builtInAgentPresets, type Agent } from '@dovo/protocol'
import { AgentRegistry } from '../../configuration/registry.js'

it.skipIf(process.platform === 'win32').each([
  { permission: 'ask', saved: 'yolo', offersAuto: true, applied: 'default' },
  { permission: 'auto', saved: undefined, offersAuto: true, applied: 'auto' },
  { permission: 'auto', saved: undefined, offersAuto: false, applied: 'default' },
  { permission: 'full-access', saved: undefined, offersAuto: true, applied: 'default' },
] satisfies {
  permission: Agent['permission']
  saved?: string
  offersAuto: boolean
  applied: string
}[])(
  'runs installed agy with $permission in $applied when Auto is advertised=$offersAuto',
  async ({ permission, saved, offersAuto, applied }) => {
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
configOptions.push({id:'mode',name:'Mode',type:'select',category:'mode',currentValue:'yolo',options:['yolo','default','plan',...(${offersAuto}?['auto']:[])].map(value=>({value,name:value}))});
let pendingPrompt;
createInterface({input:process.stdin}).on('line',line=>{
  const input=JSON.parse(line);writeFileSync(record,JSON.stringify([...calls(),{argv:process.argv.slice(2),method:input.method,params:input.params}]));
  if(input.method==='initialize')respond(input.id,{protocolVersion:1,agentInfo:{name:'antigravity-acp',version:'1.5.1'},agentCapabilities:{sessionCapabilities:{close:{}}}});
  if(input.method==='session/new')respond(input.id,{sessionId:'agy-session',configOptions});
  if(input.method==='session/set_config_option'){
    const option=configOptions.find(option=>option.id===input.params.configId);
    if(option)option.currentValue=input.params.value;
    respond(input.id,{configOptions});
  }
  if(input.method==='session/prompt'){
    pendingPrompt=input.id;
    send({id:'approval',method:'session/request_permission',params:{sessionId:'agy-session',toolCall:{toolCallId:'read',kind:'read',title:'Escalated'},options:[{optionId:'yes',name:'Allow',kind:'allow_once'},{optionId:'no',name:'Reject',kind:'reject_once'}]}});
  }
  if(input.id==='approval'){
    send({method:'session/update',params:{sessionId:'agy-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Antigravity fixture reply'}}}});
    respond(pendingPrompt,{stopReason:'end_turn'});
  }
  if(input.method==='session/close')respond(input.id,{});
});
`,
      )
      await chmod(executable, 0o700)
      const preset = builtInAgentPresets().find((agent) => agent.id === 'dovo:antigravity')!
      const agent = {
        ...preset,
        permission,
        model: 'gemini-fixture',
        env: {
          PATH: directory + delimiter + (process.env.PATH ?? ''),
          DOVO_AGY_FIXTURE_RECORD: record,
        },
      }
      const adapter = await registry.get(agent.provider)
      expect((await adapter.models?.(agent))?.models).toEqual([
        { id: 'gemini-fixture', name: 'Gemini fixture', isDefault: true },
      ])
      const text: string[] = []
      const sessions: string[] = []
      const approvals: string[] = []
      await adapter.run({
        agent: { ...agent, acpMode: saved, acpConfig: saved ? { mode: saved } : undefined },
        cwd: directory,
        prompt: 'Reply from the fixture',
        signal: new AbortController().signal,
        onSession: (id) => sessions.push(id),
        onText: (chunk) => text.push(chunk),
        onActivity: () => {},
        approve: async (title) => {
          approvals.push(title)
          return 'deny'
        },
        ask: async () => null,
      })
      expect(sessions).toEqual(['agy-session'])
      expect(text.join('')).toBe('Antigravity fixture reply')
      const calls: Array<{
        argv: string[]
        method?: string
        params?: { configId?: string; value?: string }
      }> = JSON.parse(await readFile(record, 'utf8'))
      expect(calls.every((call) => JSON.stringify(call.argv) === '["acp"]')).toBe(true)
      expect(calls.flatMap((call) => (call.method ? [call.method] : []))).toEqual([
        'initialize',
        'session/new',
        'session/close',
        'initialize',
        'session/new',
        'session/set_config_option',
        'session/set_config_option',
        'session/prompt',
        'session/close',
      ])
      expect(
        calls
          .filter(({ params }) => params?.configId === 'mode')
          .map(({ params }) => params?.value),
      ).toEqual([applied])
      expect(approvals).toEqual(permission === 'auto' ? ['Escalated'] : [])
    } finally {
      await registry.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
