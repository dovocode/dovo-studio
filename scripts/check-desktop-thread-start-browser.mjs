import { readFileSync } from 'node:fs'
const fixtureUrl = new URL('./check-composer-send-browser.mjs', import.meta.url)
const source = readFileSync(fixtureUrl, 'utf8')
const app = `
import {responses} from '@dovo/protocol';import {createRoot} from 'react-dom/client';import {useState,useCallback} from 'react';import {WorkspaceHarness} from '@dovo/studio-core';import {StartupDraft} from './src/task-creation/startup-draft';
window.requests=[];window.flushes=[];window.commits=[];window.rootEdits=0;window.finish=null;window.fail=false;window.pending=false;window.threadStart=window.threadStart??true;
window.command=input=>{window.commandDone=false;window.commandError='';void window.temporaryWorkspace.request('/api/tasks/message',input,responses.ok).then(()=>{window.commandDone=true},error=>{window.commandError=error.message;window.commandDone=true})};function App(){const[visible,setVisible]=useState(true);window.setVisible=setVisible;const[workspace,setWorkspace]=useState({tasks:[],repositories:[{id:'general',kind:'scratch',name:'General',path:'/general',branch:''}],agents:[],skills:[],mcpServers:[]});window.workspace=workspace;const onDraftChange=useCallback(task=>{window.draft=task},[]);const request=async(path,input)=>{window.requests.push({path,input:JSON.parse(JSON.stringify(input))});if(path==='/api/tasks/message'){if(input.createTask)setWorkspace(w=>w.tasks.some(task=>task.id===input.createTask.id)?w:{...w,tasks:[input.createTask,...w.tasks]});return new Promise((resolve,reject)=>{window.finish=()=>window.fail?reject(Error('Send failed')):resolve({ok:true,pending:window.pending})})}return {ok:true,title:'Generated'}};const edit=update=>{window.rootEdits++;setWorkspace(update)};return <WorkspaceHarness value={{workspace,setWorkspace:edit,request,connected:true,activeRuntimeId:'computer',connection:{address:'http://computer',token:'token'},flush:async taskId=>{window.flushes.push(taskId)},snapshot:{workspace,defaults:{},questions:[],runs:[],autoProjectSelectionEnabled:true,autoProjectModelSelection:'smart',messageSetupSupported:true,threadStartSupported:window.threadStart||undefined,promptQueueStagingSupported:true,queuedTurnSettingsSupported:true,persistentTurnModelsSupported:true,permissionPolicySupported:true,planModeSupported:true}}}>{visible&&<StartupDraft onProject={()=>{}} onDraftChange={onDraftChange} onCommit={task=>window.commits.push(task.id)}/>}</WorkspaceHarness>};createRoot(document.getElementById('app')).render(<App/>);
`
const beforeBuild = source.slice(0, source.indexOf('const built = await build'))
const build = source.slice(
  source.indexOf('const built = await build'),
  source.indexOf('const browser = await chromium.launch'),
)
const contentsStart = build.indexOf('    contents: `') + '    contents: `'.length
const contentsEnd = build.indexOf('`,\n    resolveDir:', contentsStart)
if (contentsStart < 14 || contentsEnd < contentsStart) throw new Error('Composer fixture changed')
const mocks = `
delete mocks['./composer-editor'];
mocks['@dovo/studio-core'] += "export {createTask} from '../studio-core/src/workspace/actions';export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';";
mocks['@dovo/studio-ui'] += "export {ComposerTextarea} from '../studio-ui/src/composer-surface';";
mocks['./context'] = "export {useWorkspace} from '@dovo/studio-core';";
mocks['./selector'] = "import {WorkspaceHarness} from '@dovo/studio-core';export const WorkspaceValueProvider=({value,children})=>{window.temporaryWorkspace=value;return <WorkspaceHarness value={value}>{children}</WorkspaceHarness>};";
mocks['../chat/composer/composer-workspace'] = mocks['./composer-workspace'];
mocks['./task-empty-state'] = "export const TaskEmptyState=()=>null;";
`
const test = `
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://dovo.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}));
 const load=async(threadStart=true)=>{await page.goto('https://dovo.test/');await page.evaluate(value=>{window.threadStart=value},threadStart);await page.addScriptTag({content:built.outputFiles[0].text});await page.getByRole('textbox',{name:'Message thread'}).waitFor()};
 const input=page.getByRole('textbox',{name:'Message thread'});
 const send=async()=>{await page.getByRole('button',{name:'Send to agent',exact:true}).click();await page.waitForFunction(()=>window.finish!==null)};
 const settle=()=>page.waitForFunction(()=>document.querySelector('form').getAttribute('aria-busy')!=='true');
 const messages=()=>page.evaluate(()=>window.requests.filter(item=>item.path==='/api/tasks/message').map(item=>item.input));
 // A command from an untouched startup view creates its thread and first message together.
 await load();const id=await page.evaluate(()=>window.draft.id);
 const command={id,messageId:'first-command',text:'Start a combined thread',selectProject:true,initialTitle:{before:'New thread',after:'Start a combined thread'}};
 await page.evaluate(input=>window.command(input),command);await page.waitForFunction(()=>window.finish!==null);
 assert.deepEqual(await page.evaluate(()=>window.requests.map(item=>item.path)),['/api/tasks/message']);
 const [first]=await messages();assert.equal(first.createTask.id,id);assert.equal(first.createTask.draft,'');assert.deepEqual(first.createTask.messages,[]);assert.equal(first.selectProject,true);assert.equal(first.initialTitle.after,command.text);
 assert.deepEqual(await page.evaluate(()=>window.commits),[]);
 await page.evaluate(()=>{window.fail=true;window.finish();window.finish=null});await page.waitForFunction(()=>window.commandDone);
 assert.equal(await page.evaluate(()=>window.commandError),'Send failed');assert.equal(await page.evaluate(()=>window.rootEdits),0);
 await page.evaluate(()=>{window.fail=false});await page.evaluate(input=>window.command(input),command);await page.waitForFunction(()=>window.finish!==null);
 const retried=(await messages()).at(-1);assert.equal(retried.messageId,first.messageId);assert.deepEqual(retried.createTask,first.createTask);
 await page.evaluate(()=>window.finish());await page.waitForFunction(()=>window.commandDone);assert.deepEqual(await page.evaluate(()=>window.commits),[id]);
 // Local durable admission also commits the thread without a separate creation edit.
 await load();const saved=await page.evaluate(()=>window.draft.id);await page.evaluate(id=>window.command({id,messageId:'saved',text:'Saved offline'}),saved);await page.waitForFunction(()=>window.finish!==null);
 await page.evaluate(()=>{window.pending=true;window.finish()});await page.waitForFunction(()=>window.commandDone);assert.deepEqual(await page.evaluate(()=>window.commits),[saved]);assert.equal(await page.evaluate(()=>window.rootEdits),0);
 // Normal typing saves at the existing composer interval; no extra delay is added.
 await load();const paused=await page.evaluate(()=>window.draft.id);await input.fill('Paused draft');
 await page.waitForFunction(id=>window.commits.includes(id),paused,{timeout:3000});
 assert.equal(await page.evaluate(()=>window.rootEdits),1);
 assert.equal(await page.evaluate(id=>window.workspace.tasks.find(task=>task.id===id)?.draft,paused),'Paused draft');
 assert.deepEqual(await page.evaluate(()=>window.requests),[]);
 await send();assert.equal((await messages())[0].createTask,undefined);assert.equal(await page.evaluate(id=>window.flushes.length>0&&window.flushes.every(value=>value===id),paused),true);
 await page.evaluate(()=>window.finish());await settle();
 // Leaving a saved draft preserves its text and does not enqueue another creation.
 await load();const left=await page.evaluate(()=>window.draft.id);await input.fill('Leave quickly');await page.waitForFunction(id=>window.commits.includes(id),left);
 await page.evaluate(()=>window.setVisible(false));await input.waitFor({state:'detached'});
 assert.equal(await page.evaluate(id=>window.workspace.tasks.find(task=>task.id===id)?.draft,left),'Leave quickly');
 assert.deepEqual(await page.evaluate(()=>window.commits),[left]);
 assert.equal(await page.evaluate(()=>window.rootEdits),1);
 // Older runtimes keep the separate draft creation and a plain first message.
 await load(false);const legacy=await page.evaluate(()=>window.draft.id);
 await input.fill('Legacy thread');await page.waitForFunction(id=>window.commits.includes(id),legacy);
 assert.equal(await page.evaluate(()=>window.workspace.tasks.length),1);
 await send();assert.equal((await messages())[0].createTask,undefined);
 await page.evaluate(()=>window.finish());await settle();
 assert.deepEqual(errors,[]);
 console.log('Desktop thread start: one combined startup command, stable failed retry identity, durable admission, normal typed Send and draft save without an extra delay, scoped flush, draft retention on leaving, and legacy fallback passed.');
}finally{await browser.close()}
`
const setup = (beforeBuild + mocks + build.slice(0, contentsStart) + app + build.slice(contentsEnd))
  .replace("'esbuild'", JSON.stringify(import.meta.resolve('esbuild')))
  .replace(
    "'./browser/harness.mjs'",
    JSON.stringify(new URL('./browser/harness.mjs', import.meta.url).href),
  )
  .replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
await import(`data:text/javascript;base64,${Buffer.from(setup + test).toString('base64')}`)
