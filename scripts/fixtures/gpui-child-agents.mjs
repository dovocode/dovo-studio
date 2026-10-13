// Private provider sessions: exercise native child APIs without invoking a real CLI.
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startRuntime } from '../../packages/runtime/dist/index.js'
import { taskFamilyRunToken } from '../../packages/protocol/dist/index.js'
const root = process.env.DOVO_DATA_ROOT
if (!root) throw new Error('DOVO_DATA_ROOT is required')
const directory = join(root, 'project')
await mkdir(directory, { recursive: true })
execFileSync('git', ['init', '-q', '-b', 'main', directory])
const token = randomBytes(32).toString('hex')
const runtime = await startRuntime({ databasePath: join(root, 'runtime.sqlite'), ownerToken: token, host: '127.0.0.1', port: 0 })
const controller = new AbortController()
async function stop() { controller.abort(); await runtime.close(); process.exit(0) }
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
const s = runtime.services
s.store.update(() => ({version: 1, runtimeAddress: '', agents: [{id:'agent',name:'Private agent',provider:'claude',model:'',permission:'ask',instructions:'',endpoint:''}], repositories:[{id:'repo',name:'Private project',path:directory,branch:'main'}],tasks:[],automations:[]}))
s.agents.get = async () => ({
  probe: async () => ({ provider:'claude', available:true, detail:'Private fixture' }),
  run: async run => {
    const session = 'private-session-' + run.taskId
    run.onSession(session)
    run.onNativeSession?.({
      stop: async () => run.onSubagentEvent?.('system', {type:'system',subtype:'task_notification',task_id:'native-child',status:'stopped'},session),
      readThread: async () => Array.from({length:55},(_,i)=>({id:'entry-'+i,role:i%2?'assistant':'user',text:'Native child entry '+i+' 🦀'})),
    },session)
    run.onSubagentEvent?.('system',{type:'system',subtype:'task_started',task_type:'local_agent',task_id:'native-child',description:'Private native worker'},session)
    run.onNativeTurnEnd?.()
    run.onText('Parent reply remains separate from the child transcript.')
  },
})
const task=s.tasks.create({title:'Native family',repositoryId:'repo',agentId:'agent',objective:'Inspect child',execution:'main'})
await (await s.tasks.start(task.id)).done
s.store.updateTask(task.id,current=>({...current,nativeTodos:[{text:'Inspect native transcript',status:'completed'},{text:'Check scoped approvals',status:'in-progress'},{text:'Stop native session',status:'pending'}]}))
const child=s.tasks.create({title:'Delegated thread',repositoryId:'repo',agentId:'agent',objective:'Read saved result',execution:'main'})
s.store.updateTask(child.id,current=>({...current,status:'review',delegation:{parentTaskId:task.id,parentRunId:'fixture-attempt',key:'private-child'}}))
s.store.updateTask(task.id,current=>({...current,subagents:[...(current.subagents??[]),{id:child.id,taskId:child.id,source:'dovo',provider:'claude',name:'Delegated thread',status:'completed',result:'Saved delegated result',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),finishedAt:new Date().toISOString()}]}))
void s.approvals.request(child.id,'Scoped child action','Fixture operation',controller.signal,undefined,{session:true,always:true}).then(async decision=>{await writeFile(join(root,'decision.pending'),JSON.stringify({decision}));await rename(join(root,'decision.pending'),join(root,'decision.json'))})
await writeFile(join(root,'fixture.json'),JSON.stringify({taskId:task.id,childTaskId:child.id,runToken:taskFamilyRunToken(s.store.get().tasks,task.id)}))
await writeFile(join(root,'runtime-connection.pending'),JSON.stringify({address:`http://127.0.0.1:${runtime.port}`,token}),{mode:0o600})

await rename(join(root,'runtime-connection.pending'),join(root,'runtime-connection.json'))
