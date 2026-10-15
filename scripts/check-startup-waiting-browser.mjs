import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
// Use the real synchronization class: even an empty flush publishes sync state. A mock
// flush that never updates the provider misses the draft-to-thread request feedback loop.
const built = await build({
  stdin: {
    contents: `
      import {useCallback,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {createTask} from '${root}packages/studio-core/src/workspace/actions';
      import {useWorkspace} from '${root}packages/studio-core/src/workspace/context';
      import {WorkspaceValueProvider} from '${root}packages/studio-core/src/workspace/selector';
      import {TemporaryTaskWorkspace} from '${root}packages/studio-core/src/workspace/temporary-task';
      import {WorkspaceSynchronization} from '${root}packages/studio-core/src/runtime/synchronization';
      import {useTaskWaiting} from '${root}packages/studio-core/src/use-task-waiting';
      import {taskWaitingSchema,responses} from '@dovo/protocol';
      window.counts={waiting:0,flushes:0,publishes:0,commits:0};
      const sync=new WorkspaceSynchronization(()=>{},undefined,undefined,()=>{
        window.counts.publishes++;
        // Bound a regression so a failing test cannot hang the browser indefinitely.
        if(window.counts.publishes<40)window.publish?.();
      });
      sync.bind({address:'http://projectless.lan:51464',token:'fixture-token'});
      const task=createTask({title:'New task',objective:'',agentId:'',repositoryId:'scratch'});
      const flush=async()=>{window.counts.flushes++;await sync.flush()};
      const request=async(path)=>{
        await sync.flush();
        if(path==='/api/tasks/waiting')window.counts.waiting++;
        return path==='/api/tasks/waiting'?{dependencies:[],related:[]}:{ok:true};
      };
      function Waiting(){
        const {request}=useWorkspace();
        const read=useCallback(input=>request('/api/tasks/waiting',input,taskWaitingSchema),[request]);
        const {busy}=useTaskWaiting(task.id,true,read,'projectless-runtime');
        return <span data-waiting={busy?'busy':'ready'}>Watching</span>;
      }
      function Thread({committed}){
        const store=useWorkspace();
        window.visibleTask=store.workspace.tasks.find(item=>item.id===task.id);
        window.threadRequest=store.request;
        return <>
          <button onClick={()=>store.setWorkspace(workspace=>({...workspace,tasks:workspace.tasks.map(item=>item.id===task.id?{...item,draft:'Hello'}:item)}))}>Save draft</button>
          <button onClick={()=>store.request('/api/tasks/message',{id:task.id,text:'Hello'},responses.ok)}>Send</button>
          {committed&&<Waiting/>}
        </>;
      }
      function App(){
        const [workspace,setWorkspace]=useState({tasks:[],repositories:[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch'}]});
        const [version,setVersion]=useState(0);
        const [committed,setCommitted]=useState(false);
        window.saved=workspace.tasks;
        window.publish=()=>setVersion(value=>value+1);
        return <WorkspaceValueProvider value={{workspace,setWorkspace,flush,request,version}}>
          <TemporaryTaskWorkspace task={task} onCommit={()=>{window.counts.commits++;setCommitted(true)}}>
            <Thread committed={committed}/>
          </TemporaryTaskWorkspace>
        </WorkspaceValueProvider>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir: `${root}packages/studio-ui`,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch()
try {
  for (const action of ['Save draft', 'Send']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: action, exact: true }).waitFor()
    await page.evaluate(() => {
      window.originalRequest = window.threadRequest
    })
    await page.getByRole('button', { name: action, exact: true }).click()
    await page.locator('[data-waiting="ready"]').waitFor()
    // Allow both nested flush publications to render before checking that polling settled.
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.counts.waiting), 1, action)
    assert.equal(await page.evaluate(() => window.counts.commits), 1, action)
    assert.equal(await page.evaluate(() => window.saved.length), 1, action)
    assert.equal(
      await page.evaluate(() => window.originalRequest === window.threadRequest),
      true,
      action,
    )
    await page.evaluate(() => window.publish())
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.counts.waiting), 1, action)
    assert.deepEqual(errors, [], action)
    await page.close()
  }
  console.log(
    'Projectless draft commit and first send settle after one watcher read through real sync publications; unrelated provider updates preserve the reader.',
  )
} finally {
  await browser.close()
}
