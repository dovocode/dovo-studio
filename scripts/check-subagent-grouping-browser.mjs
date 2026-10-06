import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const state = `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,set]=useState(initial);const ref=useRef(value);ref.current=value;return [value,set,ref]}`
const controls = `
export const Button=({children,onClick,disabled,...props})=><button disabled={disabled} onClick={onClick} {...props}>{children}</button>;
export const Input=props=><input {...props}/>;
export const ChoicePicker=({children,value,onValueChange,...props})=><select value={value} onChange={e=>onValueChange(e.target.value)} {...props}>{children}</select>;
export const cn=(...values)=>values.filter(Boolean).join(' ');
export const AgentAvatar=()=>null;export const ProjectIcon=()=>null;export const useModelLabel=()=>'';
export const Tooltip=({children})=><>{children}</>;export const TooltipTrigger=Tooltip;export const TooltipContent=()=>null;
export const PageHeader=({title})=><h1>{title}</h1>;
export const ContextMenu={Label:({children})=><span>{children}</span>,Item:Tooltip,Sub:Tooltip,SubTrigger:Tooltip,Portal:Tooltip,SubContent:Tooltip};
export const Text=({children,accessibilityLabel})=><span aria-label={accessibilityLabel}>{children}</span>;
export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;
export const ScrollView=View;export const Image=()=>null;
export const Pressable=({children,onPress,onLongPress,disabled,accessibilityLabel,accessibilityState,testID})=><button data-testid={testID} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} disabled={disabled} onClick={onPress} onContextMenu={e=>{e.preventDefault();onLongPress?.()}}>{children}</button>;
export const FlatList=({data,renderItem,ListHeaderComponent,ListEmptyComponent})=><div>{ListHeaderComponent}{data.length?data.map((item,i)=><div key={i}>{renderItem({item})}</div>):ListEmptyComponent}</div>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const ScreenHeader=({title})=><h1>{title}</h1>;
export const Icon=()=>null;export const IconButton=({label,onPress})=><button onClick={onPress}>{label}</button>;
export const Sheet=View;export const colors={};export const styles={};export const useTheme=()=>({styles,colors,mode:'dark'});export const Alert={alert:()=>{}};
`
const fixture = `
const base={repositoryId:'repo',agentId:'',status:'running',createdAt:'2026-10-03T12:00:00Z',draft:'',files:[],messages:[],example:false};
const record=(id,name,status='working',source='dovo')=>({id,taskId:source==='dovo'?id:undefined,source:source==='dovo'?'dovo':undefined,name,provider:'codex',status,activity:status==='working'?'Inspecting tests':'Saved result',startedAt:'2026-10-03T12:00:00Z',updatedAt:'2026-10-03T12:01:00Z'});
const parent={...base,id:'parent',title:'Main thread',subagents:[record('child','Live child'),record('done','Ended child','completed'),record('native','Native worker','working','native')]};
const child={...base,id:'child',title:'Independent child title',delegation:{parentTaskId:'parent',parentRunId:'run',key:'child'},subagents:[record('nested','Nested child'),record('nested-native','Nested native','working','native')]};
const nested={...base,id:'nested',title:'Independent nested title',delegation:{parentTaskId:'child',parentRunId:'child-run',key:'nested'}};
const done={...base,id:'done',title:'Independent ended title',status:'done',delegation:{parentTaskId:'parent',parentRunId:'run',key:'done'}};
const second={...base,id:'second',title:'Another main thread'};
window.workspace={repositories:[{id:'repo',name:'Project',path:'/project',branch:'main'}],tasks:[parent,child,nested,done,second],agents:[]};
const snapshot={workspace:window.workspace,questions:[],approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],revision:1};
const profile={id:'linux',name:'Linux',connection:{address:'http://linux.local:51464',token:'test-token'}};
window.source={runtimeId:'linux',address:profile.connection.address,name:'Linux',workspace:window.workspace,snapshot,online:true};
window.overview={profile,snapshot,connected:true,lastSeen:null,error:null,pulls:null,pullError:null};
window.opened=[];window.routes=[];window.switches=[];window.orders=[];
window.host={navigate:target=>window.routes.push(target)};
window.store={workspace:window.workspace,snapshot,connected:true,activeRuntimeId:'mac',activeId:'mac',runtimeRegistry:{profiles:[profile]},profiles:[profile],overviews:[window.overview],runtimes:[window.overview],profile,ready:true,refreshAll:async()=>{},refreshRuntimes:async()=>{},selectRuntimeEffect:id=>Effect.sync(()=>window.switches.push(id))};
window.publishTasks=tasks=>{window.workspace={...window.workspace,tasks};const next={...window.store.snapshot,workspace:window.workspace};window.source={...window.source,workspace:window.workspace,snapshot:next};window.overview={...window.overview,snapshot:next};window.store={...window.store,workspace:window.workspace,snapshot:next,overviews:[window.overview],runtimes:[window.overview]};};
window.preferences={taskSort:'newest',taskGrouping:'none'};
`

async function bundle(contents) {
  const mocks = {
    '@dovo/studio-core': `export * from '@dovo/protocol';export const providers={codex:{short:'Codex',name:'Codex'}};export const useWorkspace=()=>window.store;export const useStudioHost=()=>window.host;export const useAppPreferences=()=>window.preferences;export const readAppPreferences=()=>window.preferences;export const useRuntimeSources=()=>[window.overview];export const formatDateTime=x=>String(x);`,
    '@dovo/studio-core/state': state,
    '@dovo/studio-ui': controls,
    '@dovo/extension-scm/projects': 'export const ProjectsMenu=()=>null;',
    'react-native': controls,
    'lucide-react-native': 'export * from "lucide-react";',
    'expo-router': 'export const router={push:()=>{}};',
    './use-task-search': 'export const useTaskSearch=()=>({keys:new Set(),error:""});',
    '../detail/task-context-menu':
      'export const TaskContextMenu=({children,selectionMenu})=><div>{children}{selectionMenu}</div>;',
    '../detail/task-lifecycle-actions': 'export const TaskLifecycleActions=()=>null;',
    './task-row-menu': 'export const TaskRowMenu=()=>null;',
    './task-swipe-actions':
      'export const TaskSwipeActions=({children})=><div data-swipe="true">{children}</div>;',
    './device-label': 'export const DeviceLabel=()=>null;',
    '../../agents/harness-icon': 'export const HarnessIcon=()=>null;',
    '../../agents/use-model-catalog':
      'export const useCachedModelCatalog=()=>({modelName:"",catalog:null});',
    '../../runtime/state/app-active': 'export const useForegroundInterval=()=>{};',
    '../runtime/state/app-active': 'export const useForegroundInterval=()=>{};',
  }
  const output = await build({
    stdin: { contents, loader: 'tsx', resolveDir: root },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
    plugins: [
      {
        name: 'boundary-mocks',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path }) => {
            if (mocks[path]) return { path, namespace: 'mock' }
            if (/runtime\/state\/application-state$/.test(path))
              return { path: 'state', namespace: 'mock' }
            if (/runtime\/connection\/provider$/.test(path))
              return { path: 'runtime', namespace: 'mock' }
            if (/shell\/navigation$/.test(path)) return { path: 'navigation', namespace: 'mock' }
            if (/runtime\/preferences\/app-preferences$/.test(path))
              return { path: 'preferences', namespace: 'mock' }
            if (/runtime\/state\/native-effect$/.test(path))
              return { path: 'workflow', namespace: 'mock' }
            if (/use-task-lifecycle$/.test(path)) return { path: 'lifecycle', namespace: 'mock' }
            if (/task-list-view$/.test(path)) return { path: 'list-state', namespace: 'mock' }
            if (/ui\/controls\/use-action$/.test(path)) return { path: 'action', namespace: 'mock' }
            if (/use-list-scroll$/.test(path)) return { path: 'scroll', namespace: 'mock' }
            if (/fleet-overview$|project-thread-filter$|lifecycle-actions$/.test(path))
              return { path: 'empty', namespace: 'mock' }
            if (/ui\//.test(path) && path.startsWith('.'))
              return { path: 'controls', namespace: 'mock' }
          })
          b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            loader: 'tsx',
            resolveDir: root + '/packages/studio-ui',
            contents:
              mocks[path] ??
              {
                state,
                runtime: 'export const useRuntime=()=>window.store;',
                navigation:
                  'export const useNavigation=()=>({focused:true,navigate:(view,entityId,runtimeId)=>window.routes.push({view,entityId,runtimeId})});',
                preferences:
                  'export const useCarMode=()=>false;export const useMobilePreferences=()=>window.preferences;export const updateMobilePreferences=()=>{};',
                workflow:
                  'import {Effect} from "effect";export const mobileWorkflow=Effect.gen;export const nativeEffect=fn=>Effect.tryPromise(fn);',
                lifecycle:
                  'export const useTaskLifecycle=()=>({unread:false,error:"",enabled:true,busy:false});export const chooseSnoozeDuration=()=>{};',
                'list-state':
                  'import {useState,useRef} from "react";export const useTaskListView=()=>{const [view,setView]=useState({search:"",source:"all",project:"",sort:"newest"});return {view,setView,scrollOffset:useRef(0)}};',
                action:
                  'import {Effect} from "effect";export const useAction=()=>({busy:false,error:"",act:fn=>Effect.runPromise(fn())});',
                scroll: 'export const useListScroll=()=>({retainPosition:()=>{}});',
                empty:
                  'export const FleetOverview=()=>null;export const ProjectThreadFilter=()=>null;export const LifecycleActions=()=>null;',
                controls,
              }[path],
          }))
        },
      },
    ],
  })
  return output.outputFiles[0].text
}

const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.setDefaultTimeout(8000)
    await page.setContent('<div id="app"></div>')
    const app = mobile
      ? `import TasksScreen from '${root}/apps/mobile/src/screens/tasks.tsx';import {TaskAgents} from '${root}/apps/mobile/src/tasks/detail/task-agents.tsx';window.renderList=archived=>render(<TasksScreen archived={archived}/>);`
      : `import {TaskList} from '${root}/packages/extension-tasks/src/list/task-list.tsx';import {TaskAgents} from '${root}/packages/extension-tasks/src/detail/task-agents.tsx';import Archived from '${root}/packages/extension-tasks/src/list/archived-view.tsx';window.renderList=archived=>render(archived?<Archived/>:<TaskList projectId="" onProjectChange={()=>{}} selectedId={JSON.stringify(['linux','nested'])} onSelect={entry=>window.opened.push({id:entry.task.id,runtimeId:entry.source.runtimeId})} onCreate={()=>{}} onCreateNoProject={()=>{}} onDeselect={()=>{}} onOrderChange={entries=>window.orders.push(entries.map(e=>e.task.id))} sources={[window.source]} activeRuntimeId="mac" busy={false} error=""/>);`
    await page.addScriptTag({
      content: await bundle(
        `import {createRoot} from 'react-dom/client';import {Effect} from 'effect';${app}${fixture}const root=createRoot(document.getElementById('app'));const render=node=>root.render(node);window.renderAgents=()=>render(<TaskAgents task={window.workspace.tasks[0]}/>);window.renderList(false);`,
      ),
    })
    await page.getByText('Main thread', { exact: true }).waitFor()
    assert.equal(await page.getByText('Independent child title', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Independent nested title', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Independent ended title', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Ended child · codex', { exact: true }).count(), 0)
    await page.getByText('Native worker · codex', { exact: true }).waitFor()
    await page.getByText('Nested native · codex', { exact: true }).waitFor()
    const nested = page.getByRole('button', { name: /^Open subagent Nested child/ })
    if (!mobile) assert.equal(await nested.getAttribute('aria-current'), 'true')
    await nested.click()
    if (mobile) {
      await page.waitForFunction(() => window.routes.length > 0)
      assert.deepEqual(await page.evaluate(() => window.routes[0]), {
        view: 'tasks',
        entityId: 'nested',
        runtimeId: 'linux',
      })
      assert.deepEqual(await page.evaluate(() => window.switches), ['linux'])
      await page.getByRole('button', { name: /Project, Main thread/ }).click({ button: 'right' })
      await page.getByText('1 selected', { exact: true }).waitFor()
      await page.getByRole('button', { name: /^Open subagent Live child/ }).click()
      assert.equal(await page.getByText('1 selected', { exact: true }).count(), 0)
      assert.equal(await page.evaluate(() => window.routes.length), 1)
      assert.equal(await page.locator('[data-swipe="true"]').count(), 2)
    } else {
      assert.deepEqual(await page.evaluate(() => window.opened[0]), {
        id: 'nested',
        runtimeId: 'linux',
      })
      assert.deepEqual(await page.evaluate(() => window.orders.at(-1).sort()), ['parent', 'second'])
      await page
        .getByRole('button')
        .filter({ has: page.getByText('Main thread', { exact: true }) })
        .click({ modifiers: ['Meta'] })
      assert.equal(await page.evaluate(() => window.opened.length), 1)
      assert.equal(await page.getByText('2 threads selected', { exact: true }).count(), 0)
      await page
        .getByRole('button')
        .filter({ has: page.getByText('Another main thread', { exact: true }) })
        .click({ modifiers: ['Meta'] })
      await page.getByText('2 threads selected', { exact: true }).first().waitFor()
      await page
        .getByRole('button')
        .filter({ has: page.getByText('Main thread', { exact: true }) })
        .click({ modifiers: ['Meta'] })
      await page.getByText('1 threads selected', { exact: true }).first().waitFor()
    }
    assert.equal(await page.locator('button button').count(), 0)
    await page.evaluate(() => {
      window.publishTasks(
        window.workspace.tasks.map((task) =>
          task.id === 'parent'
            ? {
                ...task,
                status: 'done',
                subagents: task.subagents.map((agent) =>
                  agent.id === 'child' ? { ...agent, status: 'completed' } : agent,
                ),
              }
            : task.id === 'child'
              ? { ...task, status: 'done' }
              : task,
        ),
      )
      window.renderList(false)
    })
    await page
      .getByRole('button', { name: /^Open subagent Live child/ })
      .waitFor({ state: 'detached' })
    await page.getByText('Native worker · codex', { exact: true }).waitFor({ state: 'detached' })
    await page.getByText('Nested native · codex', { exact: true }).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: /^Open subagent Nested child/ }).waitFor()
    await page.evaluate(() => window.renderAgents())
    await page.getByText('Ended child', { exact: true }).waitFor()
    await page.getByText('Nested child', { exact: true }).waitFor()
    assert.equal(await page.getByText('Last seen working', { exact: true }).count(), 2)
    await page.getByText('Ended child', { exact: true }).click()
    await page
      .getByRole('button', { name: 'Open child thread · codex', exact: true })
      .last()
      .click()
    assert.equal(await page.locator('button button').count(), 0)
    assert.equal(await page.evaluate(() => window.routes.at(-1).entityId), 'done')
    await page.evaluate(() => {
      window.publishTasks(
        window.workspace.tasks.map((task) => ({ ...task, archivedAt: '2026-10-03T12:02:00Z' })),
      )
      window.renderList(true)
    })
    await page.getByText('Main thread', { exact: true }).waitFor()
    assert.equal(await page.getByText('Independent child title', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Independent ended title', { exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'}: parent-only active/archive rows, native/live/nested pills, ended Agents results, runtime-scoped navigation and selection passed.`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
