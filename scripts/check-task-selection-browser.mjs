import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url))
const mocks = {
  '@dovo/studio-core/state': `import {useState,useRef} from 'react'; export function useApplicationState(initial){const [value,setValue]=useState(initial);const ref=useRef(value);ref.current=value;return [value,setValue,ref];}`,
  '@dovo/studio-core': `
export {responses} from '@dovo/protocol';
const preferences = {taskSort:'created',taskGrouping:'none',confirmArchive:false};
export const readAppPreferences = () => preferences;
export const useAppPreferences = readAppPreferences;
export const updateAppPreferences = () => {};
export const useStudioHost = () => ({});
export const resolveTaskAgent = () => null;
export const compareTasks = (a,b) => a.title.localeCompare(b.title);
export const isSnoozed = () => false;
export const taskSortOptions = [];
export const taskGroupOptions = [];
export const latestCompletedTaskTurn = task => task.turns?.at(-1);
const store = { activeRuntimeId:null, connection:null, runtimeRegistry:{profiles:[]}, request:async(path,input)=>{window.requests.push({path,input});return {ok:true}}, refreshRuntimes:async()=>{} };
export const useWorkspace = () => store;`,
  '@dovo/studio-ui': `
import React from 'react';
export * as ContextMenu from '@radix-ui/react-context-menu';
export const Button = ({variant,size,children,...props}) => React.createElement('button',props,children);
export const Input = props => React.createElement('input',props);
export const ChoicePicker = ({onValueChange,children,...props})=>React.createElement('select',{...props,onChange:event=>onValueChange(event.target.value)},children);`,
  '@dovo/extension-scm/projects': `export const ProjectsMenu = () => null;`,
  './task-row': `import React from 'react'; export const TaskRow = ({task,onSelect,selected,multiSelected,disabled}) => React.createElement('button',{'aria-current':selected?'true':undefined,'data-multi-selected':multiSelected?'true':'false',disabled,onClick:onSelect},task.title);`,
  '../detail/task-context-menu': `import React from 'react';import * as Menu from '@radix-ui/react-context-menu';export const TaskContextMenu = ({children,selectionMenu})=>React.createElement(Menu.Root,null,React.createElement(Menu.Trigger,{asChild:true},React.createElement('div',null,children)),React.createElement(Menu.Portal,null,React.createElement(Menu.Content,null,selectionMenu)));`,
}
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {TaskList} from './src/list/task-list.tsx';import {taskCollectionKey} from './src/list/task-collection.ts';
window.requests=[];
const tasks=['A','B','C'].map(title=>({id:title,title,repositoryId:'r',agentId:'',status:'completed',messages:[],files:[],draft:'',createdAt:'',turns:[{id:'turn-'+title,status:'completed'}]}));
const sources=[{runtimeId:null,name:'Local',online:true,snapshot:null,workspace:{tasks,repositories:[],agents:[]}}];
function App(){const [selected,setSelected]=useState(taskCollectionKey(null,'A'));return <TaskList projectId="" onProjectChange={()=>{}} selectedId={selected} onSelect={entry=>setSelected(entry.key)} onCreate={()=>{}} onCreateNoProject={()=>{}} onDeselect={()=>setSelected('')} sources={sources} activeRuntimeId={null} busy={false} error=""/>;}
createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: root,
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'sidebar-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'sidebar-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'sidebar-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
          loader: 'js',
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
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.getByRole('button', { name: 'B', exact: true }).click({ modifiers: ['Meta'] })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-multi-selected=true]').length === 2,
  )
  await page.getByRole('button', { name: 'C', exact: true }).click({ modifiers: ['Meta', 'Shift'] })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-multi-selected=true]').length === 3,
  )
  await page.getByRole('button', { name: 'B', exact: true }).click({ button: 'right' })
  await page.getByText('3 threads selected', { exact: true }).waitFor()
  for (const name of ['Archive', 'Reopen', 'Snooze', 'Mark as unread', 'Mark as read', 'Delete'])
    await page.getByRole('menuitem', { name, exact: true }).waitFor()
  await page.getByRole('menuitem', { name: 'Mark as read', exact: true }).click()
  await page.waitForFunction(() => window.requests.length === 3)
  const requests = await page.evaluate(() => window.requests)
  if (
    requests.some(({ path, input }) => path !== '/api/tasks/viewed' || input.viewed !== true) ||
    requests.map(({ input }) => input.id).join('') !== 'ABC' ||
    errors.length
  )
    throw new Error(JSON.stringify({ requests, errors }))

  page.on('dialog', (dialog) => dialog.accept())
  for (const [name, path] of [
    ['Archive', '/api/tasks/lifecycle'],
    ['Reopen', '/api/workspace'],
    ['Snooze', '/api/workspace'],
    ['Mark as unread', '/api/tasks/viewed'],
    ['Delete', '/api/tasks/lifecycle'],
  ]) {
    await page.evaluate(() => {
      window.requests = []
    })
    await page.getByRole('button', { name: 'A', exact: true }).click()
    await page.getByRole('button', { name: 'B', exact: true }).click({ modifiers: ['Meta'] })
    await page
      .getByRole('button', { name: 'C', exact: true })
      .click({ modifiers: ['Meta', 'Shift'] })
    await page.getByRole('button', { name: 'B', exact: true }).click({ button: 'right' })
    if (name === 'Snooze') {
      await page.getByRole('menuitem', { name, exact: true }).hover()
      await page.getByRole('menuitem', { name: 'For 24 hours', exact: true }).click()
    } else await page.getByRole('menuitem', { name, exact: true }).click()
    await page.waitForFunction(() => window.requests.length === 3)
    const batch = await page.evaluate(() => window.requests)
    if (
      batch.some((request) => request.path !== path) ||
      batch.map(({ input }) => input.id).join('') !== 'ABC'
    )
      throw new Error(`${name}: ${JSON.stringify(batch)}`)
  }
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.getByRole('button', { name: 'B', exact: true }).click({ modifiers: ['Meta'] })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-multi-selected=true]').length === 2,
  )
  await page.getByRole('button', { name: 'C', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-multi-selected=true]').length === 0,
  )
  await page.getByRole('button', { name: 'A', exact: true }).click({ modifiers: ['Shift'] })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-multi-selected=true]').length === 3,
  )
  await page.getByRole('button', { name: 'A', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-multi-selected=true]').length === 0,
  )
  if (await page.getByRole('button', { name: 'Select tasks', exact: true }).count())
    throw new Error('The explicit selection-mode icon must be removed.')
  if (await page.getByRole('button', { name: 'Archive', exact: true }).count())
    throw new Error('Bulk actions must stay inside the context menu.')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Modifier and range selection, right-click retention, all six bulk actions and their requests for all selected threads passed.',
  )
} finally {
  await browser.close()
}
