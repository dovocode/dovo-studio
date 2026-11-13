import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const mocks = {
  './bot-create-dialog': 'export const BotCreateDialog=()=>null;',

  './task-empty-state': 'export const TaskEmptyState=()=>null;',
  './section-order-dialog': 'export const SectionOrderDialog=()=>null;',
  '@dovo/studio-core/state': `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,setValue]=useState(initial);const ref=useRef(value);ref.current=value;return [value,setValue,ref]}`,
  '@dovo/studio-core': `export const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;export {clientScopeKey} from '../client-runtime/src/effects/request-scope';export const useConfirmation=()=>async options=>window.confirmationResponse?.(options)??true;
    export * from '@dovo/protocol';
    export {createTask,updateTask} from '../studio-core/src/workspace/actions';
    export {TemporaryTaskWorkspace} from '../studio-core/src/workspace/temporary-task';
    export {WorkspaceContext,useWorkspace} from '../studio-core/src/workspace/context';
    export {WorkspaceValueProvider,useWorkspaceSelector,sameWorkspaceFields} from '../studio-core/src/workspace/selector';
    const host={}; export const useStudioHost=()=>host;
    export const readAppPreferences=()=>window.preferences;
    export const useAppPreferences=readAppPreferences;
    export const updateAppPreferences=changes=>Object.assign(window.preferences, changes);
  `,
  '@dovo/studio-ui': `
export {ConversationHistory,useConversationHistory,Conversation,ConversationContent,ConversationScrollButton} from '../studio-ui/src/components/ai-elements/conversation';
export const SidebarHeader=()=>null;export const BotAvatar=()=>null;

    export const Button=({children,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{children}</button>;
    export const Input=props=><input {...props}/>;
    export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;
    export * as ContextMenu from '@radix-ui/react-context-menu';
  `,
  '../chat/composer/composer': `
    import {useWorkspace} from '@dovo/studio-core';
    export function Composer({task}){const store=useWorkspace();return <input aria-label="Message" value={task.draft} onChange={event=>store.setWorkspace(workspace=>({...workspace,tasks:workspace.tasks.map(item=>item.id===task.id?{...item,draft:event.target.value}:item)}))}/>}
  `,
  '../chat/composer/composer-workspace': 'export const ComposerWorkspace=()=>null;',
  '@dovo/extension-scm/project-transfer': 'export const ProjectTransferDialog=()=>null;',
  '@dovo/extension-scm/projects': 'export const ProjectsMenu=()=>null;',
  '../detail/task-context-menu':
    'export const TaskContextMenu=({children})=><div>{children}</div>;',
  './task-row': `export const TaskRow=({task,selected,editable,onSelect})=><button data-task-id={task.id} data-editable={editable} aria-current={selected?'true':undefined} onClick={onSelect}>{task.title} · {task.status}</button>;`,
}
const built = await build({
  conditions: ['development'],
  stdin: {
    contents: `
      import {useState,useCallback} from 'react';
      import {createRoot} from 'react-dom/client';
      import {WorkspaceValueProvider,useStudioHost,createTask,randomUUID} from '@dovo/studio-core';
      import {StartupDraft} from '../extension-tasks/src/task-creation/startup-draft';
      import {TaskList} from '../extension-tasks/src/list/task-list';
      import {collectTasks,taskCollectionKey} from '../extension-tasks/src/list/task-collection';
      import {saveTaskListViewState} from '../extension-tasks/src/list/task-list-view-state';
      saveTaskListViewState(useStudioHost(), {query:window.botListCase?'':'does-not-match',expanded:{active:false,'project:["mac","scratch"]':false}});
      window.preferences={taskSort:'priority',taskGrouping:window.testGrouping||'status',workingSection:true,collapsedThreadSections:['working','waiting','snoozed','settled']};
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
        return <WorkspaceValueProvider value={store}>
          <button id="leave" onClick={()=>setOpen(false)}>Leave</button>
          <button id="new" onClick={start}>Start new</button>
          <TaskList projectId="different-project" onProjectChange={()=>{}} selectedId={selected||temporaryEntry?.key||''} onSelect={()=>{}} onCreate={()=>{}} onNewThread={start} onDeselect={()=>{}} sources={[source]} temporaryEntry={temporaryEntry} activeRuntimeId="mac" busy={false} error=""/>
          {open&&<StartupDraft key={version} onProject={()=>{}} onDraftChange={report} onCommit={task=>{window.commits++;setSelected(taskCollectionKey('mac',task.id));setOpen(false)}}/>}
        </WorkspaceValueProvider>
      }
      function BotListCase(){
        const base=createTask({title:'Normal thread',objective:'',repositoryId:'scratch',agentId:''});
        const bot={...base,id:'bot',title:'Persistent Bot',bot:{role:'Assistant',responsibilities:'',state:'active',revision:randomUUID(),createdAt:base.createdAt,updatedAt:base.createdAt}};
        const child={...base,id:'child',title:'Delegated work',delegation:{parentTaskId:'bot',parentRunId:'run',key:'child',fingerprint:'child'}};
        const workspace={tasks:[base,bot,child],agents:[],repositories:[{id:'scratch',kind:'scratch',name:'No project',path:'/scratch',branch:''}]};
        const source={runtimeId:'mac',name:'Mac',workspace,snapshot:null,online:true};
        const store={workspace,snapshot:null,activeRuntimeId:'mac',connected:true,runtimes:[],request:async()=>({taskIds:[],hits:[]}),runtimeRegistry:{profiles:[]}};
        return <WorkspaceValueProvider value={store}><TaskList projectId="" onProjectChange={()=>{}} selectedId={window.botSelected?'["mac","bot"]':''} onSelect={()=>{}} onCreate={()=>{}} onDeselect={()=>{}} sources={[source]} activeRuntimeId="mac" busy={false} error=""/></WorkspaceValueProvider>
      }
      createRoot(document.getElementById('app')).render(window.botListCase?<BotListCase/>:<App/>);
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
  for (const selected of [false, true]) {
    const page = await browser.newPage()
    await page.setContent('<div id="app"></div>')
    await page.evaluate((selected) => {
      window.botListCase = true
      window.botSelected = selected
    }, selected)
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByLabel('Search threads', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-task-id="bot"]').count(), 0)
    await page.getByLabel('Search threads', { exact: true }).fill('Persistent Bot')
    await page.waitForTimeout(150)
    assert.equal(await page.locator('[data-task-id="bot"]').count(), 0)
    await page.getByLabel('Search threads', { exact: true }).fill('Delegated work')
    await page.locator('[data-task-id="child"]').waitFor()
    assert.equal(await page.locator('[data-task-id="bot"]').count(), 0)
    await page.close()
  }
  console.log(
    'Startup sidebar: untouched drafts retain their row on commit. Real TaskList excludes Bots with no selection, selected Bot and search; delegated work remains reachable.',
  )
} finally {
  await browser.close()
}
