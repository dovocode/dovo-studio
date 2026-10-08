import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {createTask} from '@dovo/studio-core';
      import {TaskLifecycleActions} from '../extension-tasks/src/detail/task-lifecycle-actions';
      const profile={id:'remote',name:'Remote',connection:{address:'http://remote',token:'token'}};
      const initial=createTask({title:'Remote task',objective:'',agentId:'',repositoryId:'repo'});
      window.writes=[];window.fail=false;window.localWrites=0;
      function App(){
        const [task,setTask]=useState(initial);
        const source={runtimeId:'remote',name:'Remote',online:true,workspace:{tasks:[task],repositories:[],agents:[]}};
        window.store={activeRuntimeId:'local',runtimeRegistry:{profiles:[profile]},
          request:async()=>{window.localWrites++;throw new Error('Wrong server')},
          previewTask:async(connection,id,updates,apply)=>{await apply()},
          readRuntime:async(owner,path,input,schema,method)=>{
            if(window.fail)throw new Error('Remote write failed');
            window.writes.push({owner:owner.id,path,input,method});
            const updates=Object.fromEntries(Object.entries(input.changes).map(([key,value])=>[key,value.after]));
            setTask(current=>({...current,...updates}));return {revision:1};
          },refreshRuntime:async()=>{},refreshRuntimes:async()=>{}};
        window.task=task;
        return <TaskLifecycleActions task={task} source={source}/>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
  },
  plugins: [
    {
      name: 'lifecycle-environment',
      setup(builder) {
        const mocks = {
          '@dovo/studio-core': `export * from '@dovo/protocol';export {createTask,updateTask} from '../studio-core/src/workspace/actions';export const useWorkspace=()=>window.store;`,
          '@dovo/studio-ui': `export {Button} from '../studio-ui/src/components/ui/button';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
        }
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
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Snooze task' }).click()
  await page.getByRole('menuitem', { name: 'For 1 hour' }).click()
  await page.waitForFunction(() => !!window.task.snoozedUntil)
  await page.getByRole('button', { name: 'Settle task' }).click()
  await page.getByRole('button', { name: 'Reopen task' }).waitFor()
  assert.equal(await page.evaluate(() => window.task.snoozedUntil), null)
  await page.getByRole('button', { name: 'Reopen task' }).click()
  await page.getByRole('button', { name: 'Settle task' }).waitFor()
  assert.equal(await page.evaluate(() => window.localWrites), 0)
  assert.deepEqual(
    await page.evaluate(() =>
      window.writes.map(({ owner, path, method }) => ({ owner, path, method })),
    ),
    Array(3).fill({ owner: 'remote', path: '/api/workspace', method: 'PATCH' }),
  )
  await page.evaluate(() => {
    window.fail = true
  })
  await page.getByRole('button', { name: 'Settle task' }).click()
  assert.equal(await page.getByRole('alert').textContent(), 'Remote write failed')
  assert.equal(await page.evaluate(() => window.task.archived), false)
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('button', { name: 'Settle task' }).click()
  await page.getByRole('button', { name: 'Reopen task' }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Sidebar lifecycle actions snooze, settle and reopen on the owning server; failed writes remain visible and retryable.',
  )
} finally {
  await browser.close()
}
