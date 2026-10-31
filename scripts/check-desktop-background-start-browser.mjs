import { readFileSync } from 'node:fs'
const fixtureUrl = new URL('./check-composer-send-browser.mjs', import.meta.url)
const source = readFileSync(fixtureUrl, 'utf8')
const app = `
import {createRoot} from 'react-dom/client';import {useState,useCallback} from 'react';import {WorkspaceHarness} from '@dovo/studio-core';import {StartupDraft} from './src/task-creation/startup-draft';
window.requests=[];window.backgrounds=0;window.commits=[];window.finish=null;window.fail=false;window.pending=false;
function App(){const[visible,setVisible]=useState(true);window.setVisible=setVisible;const[workspace,setWorkspace]=useState({tasks:[],repositories:[{id:'general',kind:'scratch',name:'General',path:'/general',branch:''},{id:'selected',name:'Selected',path:'/selected',branch:'main'}],agents:[],skills:[],mcpServers:[]});window.workspace=workspace;const onDraftChange=useCallback(task=>{window.draft=task},[]);const request=async(path,input)=>{window.requests.push({path,input});if(path==='/api/tasks/projects/select')return {...window.workspace.tasks.find(task=>task.id===input.id),repositoryId:'selected',autoProject:undefined,modelSelection:undefined,harnessCustomized:true,harness:{provider:'codex',model:'resolved',reasoning:'high',instructions:'',endpoint:'',permission:'read-only'}};if(path==='/api/tasks/message')return new Promise((resolve,reject)=>{window.finish=()=>window.fail?reject(Error('Send failed')):resolve({ok:true,pending:window.pending})});return {ok:true,title:'Generated'}};return <WorkspaceHarness value={{workspace,setWorkspace,request,connected:true,activeRuntimeId:'computer',connection:{address:'http://computer',token:'token'},flush:async()=>{},snapshot:{workspace,defaults:{},questions:[],runs:[],autoProjectSelectionEnabled:true,autoProjectModelSelection:'smart',promptQueueStagingSupported:true,queuedTurnSettingsSupported:true,persistentTurnModelsSupported:true,permissionPolicySupported:true,planModeSupported:true}}}>{visible&&<StartupDraft onProject={()=>{}} onDraftChange={onDraftChange} onCommit={task=>window.commits.push(task.id)} onBackgroundStarted={()=>window.backgrounds++}/>}</WorkspaceHarness>};createRoot(document.getElementById('app')).render(<App/>);
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
mocks['./selector'] = "export {WorkspaceHarness as WorkspaceValueProvider} from '@dovo/studio-core';";
mocks['../chat/composer/composer-workspace'] = mocks['./composer-workspace'];
mocks['./task-empty-state'] = "export const TaskEmptyState=()=>null;";
`
const test = `
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://dovo.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}));
 const load=async()=>{await page.goto('https://dovo.test/');await page.addScriptTag({content:built.outputFiles[0].text});await page.getByRole('textbox',{name:'Message task'}).waitFor()};
 const start=async()=>{await page.getByRole('button',{name:'More message actions',exact:true}).click();const item=page.getByRole('menuitem',{name:'Start in background'});assert.equal(await item.isEnabled(),true);await item.click();await page.waitForFunction(()=>window.finish!==null)};
 const input=page.getByRole('textbox',{name:'Message task'});
 await load();
 const original=await page.evaluate(()=>window.draft.id);
 assert.equal(await page.evaluate(()=>window.draft.autoProject),true);
 assert.equal(await page.evaluate(()=>window.draft.modelSelection),'smart');
 await input.fill('First background thread');await start();
 assert.equal(await input.getAttribute('readonly'),'');
 assert.equal(await page.evaluate(()=>window.backgrounds),0);
 const firstId=await page.evaluate(()=>window.requests.find(item=>item.path==='/api/tasks/message').input.messageId);
 await page.evaluate(()=>{window.fail=true;window.finish();window.finish=null});
 await page.getByRole('alert').filter({hasText:'Send failed'}).waitFor();
 assert.equal(await input.inputValue(),'First background thread');
 assert.equal(await page.evaluate(()=>window.draft.repositoryId),'selected');
 assert.equal(await page.evaluate(()=>window.backgrounds),0);
 await start();
 assert.equal(await page.evaluate(()=>window.requests.filter(item=>item.path==='/api/tasks/message').at(-1).input.messageId),firstId);
 await page.evaluate(()=>{window.fail=false;window.finish();window.finish=null});
 await page.waitForFunction(id=>window.draft&&window.draft.id!==id,original);
 assert.equal(await input.inputValue(),'');
 const next=await page.evaluate(()=>({draft:window.draft,backgrounds:window.backgrounds,tasks:window.workspace.tasks}));
 assert.equal(next.backgrounds,1);assert.equal(next.draft.repositoryId,'general');assert.equal(next.draft.autoProject,true);assert.equal(next.draft.modelSelection,'smart');assert.deepEqual(next.draft.messages,[]);assert.equal(next.tasks.length,1);assert.equal(next.tasks[0].id,original);
 // A saved journal command is not a confirmed background start.
 await load();const pendingTask=await page.evaluate(()=>window.draft.id);
 await input.fill('Unconfirmed background thread');await start();
 await page.evaluate(()=>{window.pending=true;window.finish();window.finish=null});
 await page.waitForFunction(()=>document.querySelector('form').getAttribute('aria-busy')!=='true');
 assert.equal(await page.evaluate(()=>window.backgrounds),0);assert.equal(await page.evaluate(()=>window.draft.id),pendingTask);
 // Leaving before an acknowledgment must not navigate/reset another screen.
 await load();await input.fill('Navigate before response');await start();
 await page.evaluate(()=>window.setVisible(false));
 await input.waitFor({state:'detached'});
 await page.evaluate(async()=>{window.finish();await new Promise(resolve=>requestAnimationFrame(resolve))});
 assert.equal(await page.evaluate(()=>window.backgrounds),0);
 // Ordinary Send retains the current thread.
 await load();const foregroundTask=await page.evaluate(()=>window.draft.id);await input.fill('Foreground thread');await page.getByRole('button',{name:'Send to agent',exact:true}).click();await page.waitForFunction(()=>window.finish!==null);await page.evaluate(()=>window.finish());await page.waitForFunction(()=>document.querySelector('form').getAttribute('aria-busy')!=='true');assert.equal(await page.evaluate(()=>window.draft.id),foregroundTask);assert.equal(await page.evaluate(()=>window.backgrounds),0);
 // Alt+Enter offers a direct keyboard path from the startup editor.
 await load();const keyboardTask=await page.evaluate(()=>window.draft.id);await input.fill('Keyboard background thread');await input.press('Alt+Enter');await page.waitForFunction(()=>window.finish!==null);await page.evaluate(()=>window.finish());await page.waitForFunction(id=>window.draft&&window.draft.id!==id,keyboardTask);assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>window.backgrounds),1);
 assert.deepEqual(errors,[]);
 console.log('Desktop background start: real startup/composer/dropdown, success reset, Scope/model retention through failed retry, stable message identity, pending journals, navigation ownership and normal Send passed.');
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
