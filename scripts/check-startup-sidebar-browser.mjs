import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  '@dovo/studio-core/state': `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,setValue]=useState(initial);const ref=useRef(value);ref.current=value;return [value,setValue,ref]}`,
  '@dovo/studio-core': `
    export * from '@dovo/protocol';
    export {createTask,updateTask} from '../studio-core/src/workspace/actions';
    export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';
    export {WorkspaceContext,useWorkspace} from '../studio-core/src/workspace/context';
    const host={}; export const useStudioHost=()=>host;
    export const readAppPreferences=()=>window.preferences;
    export const useAppPreferences=readAppPreferences;
  `,
  '@dovo/studio-ui': `
    export const Button=({children,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{children}</button>;
    export const Input=props=><input {...props}/>;
    export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;
    export const ContextMenu={};
  `,
  '../chat/composer/composer': `
    import {useWorkspace} from '@dovo/studio-core';
    export function Composer({task}){const store=useWorkspace();return <input aria-label="Message" value={task.draft} onChange={event=>store.setWorkspace(workspace=>({...workspace,tasks:workspace.tasks.map(item=>item.id===task.id?{...item,draft:event.target.value}:item)}))}/>}
  `,
  '../chat/composer/composer-workspace': 'export const ComposerWorkspace=()=>null;',
  '@dovo/extension-scm/projects': 'export const ProjectsMenu=()=>null;',
  '../detail/task-context-menu':
    'export const TaskContextMenu=({children})=><div>{children}</div>;',
  './task-row': `export const TaskRow=({task,selected,editable,onSelect})=><button data-task-id={task.id} data-editable={editable} aria-current={selected?'true':undefined} onClick={onSelect}>{task.title} · {task.status}</button>;`,
}
const built = await build({
  stdin: {
    contents: `
      import {useState,useCallback} from 'react';
      import {createRoot} from 'react-dom/client';
      import {WorkspaceContext,useStudioHost} from '@dovo/studio-core';
      import {StartupDraft} from '../extension-tasks/src/task-creation/startup-draft';
      import {TaskList} from '../extension-tasks/src/list/task-list';
      import {collectTasks,taskCollectionKey} from '../extension-tasks/src/list/task-collection';
      import {saveTaskListViewState} from '../extension-tasks/src/list/task-list-view-state';
      saveTaskListViewState(useStudioHost(), {query:'does-not-match',expanded:{active:false,'project:["mac","scratch"]':false}});
      window.preferences={taskSort:'priority',taskGrouping:window.testGrouping||'status',workingSection:true};
      window.commits=0;window.requests=[];
      function App(){
        const [workspace,setWorkspace]=useState({tasks:[],agents:[],repositories:[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}]});
        const [open,setOpen]=useState(true),[version,setVersion]=useState(0),[draft,setDraft]=useState(null),[selected,setSelected]=useState('');
        const report=useCallback(task=>setDraft(task),[]);
        const source={runtimeId:'mac',name:'Mac',workspace,snapshot:null,online:true};
        const temporaryEntry=draft?collectTasks([{...source,workspace:{...workspace,tasks:[draft]}}])[0]:undefined;
        window.saved=workspace.tasks;window.temporary=draft;
        const store={workspace,setWorkspace,activeRuntimeId:'mac',connected:true,snapshot:null,runtimes:[],runtimeRegistry:{profiles:[]},flush:async()=>{},request:async(path)=>{window.requests.push(path);return {taskIds:[],hits:[]}},refreshRuntimes:async()=>{}};
        const start=()=>{setOpen(true);setVersion(value=>value+1);setSelected('')};
        return <WorkspaceContext.Provider value={store}>
          <button id="leave" onClick={()=>setOpen(false)}>Leave</button>
          <button id="new" onClick={start}>Start new</button>
          <TaskList projectId="different-project" onProjectChange={()=>{}} selectedId={selected||temporaryEntry?.key||''} onSelect={()=>{}} onCreate={()=>{}} onNewThread={start} onDeselect={()=>{}} sources={[source]} temporaryEntry={temporaryEntry} activeRuntimeId="mac" busy={false} error=""/>
          {open&&<StartupDraft key={version} onProject={()=>{}} onDraftChange={report} onCommit={task=>{window.commits++;setSelected(taskCollectionKey('mac',task.id));setOpen(false)}}/>}
        </WorkspaceContext.Provider>
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'startup-sidebar-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir,
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  for (const grouping of ['none', 'status', 'project']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.evaluate((grouping) => {
      window.testGrouping = grouping
    }, grouping)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const row = page.locator('[data-task-id]')
    await row.waitFor()
    assert.equal(await row.getAttribute('aria-current'), 'true')
    assert.equal(await row.getAttribute('data-editable'), 'false')
    assert.equal(await page.evaluate(() => window.saved.length), 0)
    await page.locator('#leave').click()
    assert.equal(await row.count(), 0)
    assert.equal(await page.evaluate(() => window.saved.length), 0)
    await page.locator('#new').click()
    await row.waitFor()
    await page.evaluate(() => {
      window.originalRow = document.querySelector('[data-task-id]')
    })
    const id = await row.getAttribute('data-task-id')
    await page.getByLabel('Message').fill('Keep this draft')
    await page.waitForFunction(() => window.saved.length === 1 && window.temporary === null)
    assert.equal(await row.count(), 1)
    assert.equal(await row.getAttribute('data-task-id'), id)
    assert.equal(await row.getAttribute('data-editable'), 'true')
    assert.equal(
      await page.evaluate(() => window.originalRow === document.querySelector('[data-task-id]')),
      true,
    )
    assert.equal(await page.evaluate(() => window.commits), 1)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Startup sidebar: untouched drafts appear selected without persistence, disappear on leave, and retain their row when committed.',
  )
} finally {
  await browser.close()
}
