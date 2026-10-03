import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const controls = `
import {useState} from 'react';
export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;
export const Input=props=><input {...props}/>;
export const Textarea=props=><textarea {...props}/>;
export const FormField=({label,children})=><label>{label}{children}</label>;
export const ChoicePicker=({onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}/>;
export const Tooltip=({children})=><>{children}</>;
export const TooltipTrigger=({children})=>children;
export const TooltipContent=()=>null;
export const cn=(...values)=>values.filter(Boolean).join(' ');
export const Dialog=({children})=><div role="dialog">{children}</div>;
export const View=({children})=><div>{children}</div>;
export const Text=({children})=><span>{children}</span>;
export const DialogContent=View,DialogHeader=View,DialogTitle=Text,DialogDescription=Text;
export const ModelSettings=({agent,onChange})=><input aria-label="Model" value={agent.model} onChange={event=>onChange({...agent,model:event.target.value})}/>;
export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
export const Field=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const styles={};
`
const browser = await chromium.launch({ headless: true })
try {
  for (const mobile of [false, true]) {
    const mocks = {
      '@dovo/studio-core': `export * from '@dovo/protocol';export {providers} from '${root}/packages/studio-core/src/providers.ts';export const useWorkspace=()=>window.store;export const updateTask=(workspace,id,update)=>({...workspace,tasks:workspace.tasks.map(task=>task.id===id?update(task):task)});`,
      '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
      '@dovo/studio-ui':
        controls +
        `export {LinkedCheckoutEditor} from '${root}/packages/studio-ui/src/linked-checkouts.tsx';`,
      'react-native': controls,
      'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
      '../../runtime/connection/provider': `export const useRuntime=()=>({connected:window.store.connected,snapshot:{workspace:window.store.workspace},call:window.store.request});`,
    }
    const built = await build({
      stdin: {
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {defaultTaskHarness} from '@dovo/protocol';
import {LinkedProjects} from '${root}/${mobile ? 'apps/mobile/src/tasks' : 'packages/extension-tasks/src'}/detail/linked-projects.tsx';
${mobile ? '' : `import {TaskTools} from '${root}/packages/extension-tasks/src/detail/task-tools.tsx';import {HarnessDialog} from '${root}/packages/extension-tasks/src/dialogs/harness-dialog.tsx';`}
const agent={...defaultTaskHarness('codex'),id:'writer',name:'Writer',model:'old-model',instructions:'Saved instructions',skills:['skill'],mcpServers:['server']};
const initial={id:'thread',title:'Thread',repositoryId:'repo',status:'draft',agentId:agent.id,harness:null,messages:[],files:[],linkedCheckouts:[]};
window.requests=[];window.fail=false;window.store={connected:true,workspace:{tasks:[initial],agents:[agent],repositories:[{id:'repo',name:'Main project',path:'/repo',branch:'main'},{id:'folder',name:'Reference folder',path:'/folder',branch:'',kind:'folder'}]},flush:async()=>{},request:async(path,input)=>{window.requests.push({path,input});if(window.fail)throw Error('Fixture save failed');if(path.endsWith('/choices'))return {worktrees:[{path:'/existing',branch:'feature'}]};return {ok:true}}};
function App(){const [task,setTask]=useState(initial),[surface,setSurface]=useState('chat'),[revision,setRevision]=useState(0),[configure,setConfigure]=useState(false);window.change=changes=>{Object.assign(window.store,changes);setRevision(value=>value+1)};window.task=changes=>setTask(old=>({...old,...changes}));window.store.setWorkspace=update=>{window.store.workspace=update(window.store.workspace);setTask(window.store.workspace.tasks[0])};return <div data-revision={revision}>
${mobile ? `<button onClick={()=>setSurface('projects')}>Linked projects</button>` : `<TaskTools surface={surface} onSelect={setSurface} hasDiff={false}/><button onClick={()=>setConfigure(true)}>Configure agent</button>{configure&&<HarnessDialog task={task} onClose={()=>setConfigure(false)}/>} `}
{surface==='projects'&&<aside aria-label="Workspace tools"><LinkedProjects key={task.id} task={task}/></aside>}</div>}
createRoot(document.getElementById('app')).render(<App/>);
`,
        loader: 'tsx',
        resolveDir: root,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        '@dovo/protocol': root + '/packages/protocol/src/index.ts',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules'],
      plugins: [
        {
          name: 'linked-project-environment',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) => {
              if (mocks[path]) return { path, namespace: 'mock' }
              if (
                /^(\.\/components\/ui\/(button|input)|\.\/choice-picker)$|ui\/(controls\/(action|choice|field)|content\/text|theme)$/.test(
                  path,
                )
              )
                return { path: 'controls', namespace: 'mock' }
            })
            builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents: path === 'controls' ? controls : mocks[path],
              loader: 'tsx',
              resolveDir: root,
            }))
          },
        },
      ],
    })
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://localhost/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
    )
    await page.goto('http://localhost/')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: 'Linked projects', exact: true }).click()
    const save = page.getByRole('button', { name: 'Save linked projects', exact: true })
    assert.equal(await save.isDisabled(), true)
    await page.getByRole('button', { name: 'Add checkout', exact: true }).click()
    await page.getByLabel('Linked project', { exact: true }).selectOption('folder')
    await page
      .getByLabel(mobile ? 'Access' : 'Linked project access', { exact: true })
      .selectOption('edit')
    await save.click()
    await page.waitForFunction(() =>
      window.requests.some((request) => request.path.endsWith('/save')),
    )
    const first = await page.evaluate(
      () => window.requests.find((request) => request.path.endsWith('/save')).input,
    )
    assert.equal(first.id, 'thread')
    assert.deepEqual(first.before, [])
    assert.equal(first.links[0].repositoryId, 'folder')
    assert.equal(first.links[0].execution, 'main')
    assert.equal(first.links[0].access, 'edit')
    await page.waitForFunction(
      () =>
        document.querySelector('button') &&
        [...document.querySelectorAll('button')].find(
          (button) => button.textContent === 'Save linked projects',
        ).disabled,
    )
    await page.getByRole('button', { name: 'Remove link', exact: true }).click()
    await page.evaluate(() => (window.fail = true))
    await save.click()
    await page.getByText('Fixture save failed', { exact: true }).waitFor()
    assert.equal(await save.isEnabled(), true)
    await page.evaluate(() => (window.fail = false))
    await save.click()
    await page.waitForFunction(
      () => window.requests.filter((request) => request.path.endsWith('/save')).length === 3,
    )
    const removed = await page.evaluate(() => window.requests.at(-1).input)
    assert.deepEqual(removed.before, first.links)
    assert.deepEqual(removed.links, [])
    for (const changes of [
      { status: 'running' },
      { status: 'draft', queue: [{ id: 'queued', text: 'Pending' }] },
      { queue: [], delegation: { parentTaskId: 'parent' } },
      { delegation: undefined, archivedAt: '2026-10-03' },
    ]) {
      await page.evaluate((changes) => window.task(changes), changes)
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('button')].find(
            (button) => button.textContent === 'Add checkout',
          ).disabled,
      )
    }
    await page.evaluate(() => {
      window.task({ archivedAt: undefined })
      window.change({ connected: false })
    })
    assert.equal(
      await page.getByRole('button', { name: 'Add checkout', exact: true }).isDisabled(),
      true,
    )
    if (!mobile) {
      await page.evaluate(() => window.change({ connected: true }))
      await page.getByRole('button', { name: 'Configure agent', exact: true }).click()
      await page.getByLabel('Model', { exact: true }).fill('new-model')
      await page.getByLabel('Harness access', { exact: true }).selectOption('workspace-write')
      await page.getByRole('button', { name: 'Save harness', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
      const workspace = await page.evaluate(() => window.store.workspace)
      assert.equal(workspace.tasks[0].agentId, 'writer')
      assert.equal(workspace.tasks[0].agentOverrides.model, 'new-model')
      assert.equal(workspace.tasks[0].agentOverrides.permission, 'workspace-write')
      assert.equal(workspace.agents[0].model, 'old-model')
      assert.equal(workspace.agents[0].instructions, 'Saved instructions')
      assert.deepEqual(workspace.agents[0].skills, ['skill'])
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop sidebar'}: linked project add/edit/remove, save conflict payloads, failure retry and editing restrictions passed.`,
    )
  }
} finally {
  await browser.close()
}
