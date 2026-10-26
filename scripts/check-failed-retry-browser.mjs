import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root + 'packages/studio-ui',
          loader: 'tsx',
          contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {${mobile ? 'FailedTaskRetry' : 'RunControls'} as Controls} from '${root}${mobile ? 'apps/mobile/src/tasks/conversation/components/failed-task-retry.tsx' : 'packages/extension-tasks/src/chat/actions/run-controls.tsx'}';
window.requests=[];window.request=(path,input)=>{window.requests.push({path,input});return new Promise((resolve,reject)=>{window.resolveRequest=resolve;window.rejectRequest=()=>reject(Error('Retry connection failed'))})};
function App(){const [state,setState]=useState({connected:true,task:{id:'task',status:'failed',error:'Exceeded retry limit, last status: 429 Too Many Requests',messages:[],draft:'Keep draft',queue:[{id:'queued',text:'Keep queued'}]}});window.update=changes=>setState(state=>({...state,...changes,task:{...state.task,...changes.task}}));window.store={connected:state.connected,request:window.request,snapshot:{runs:[],approvals:[]},runtimes:[],activeRuntimeId:'local'};window.current=state.task;return <Controls task={state.task}/>};createRoot(document.getElementById('app')).render(<App/>);
`,
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        conditions: ['development'],
        define: { 'process.env.NODE_ENV': '"production"' },
      },
      [
        {
          path: '@dovo/studio-core',
          contents: `export {responses} from '@dovo/protocol';export const useWorkspace=()=>window.store;`,
        },
        {
          path: '@dovo/studio-core/state',
          contents: `export {useState as useApplicationState} from 'react';`,
        },
        {
          path: '@dovo/studio-ui',
          contents: `export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;`,
        },
        {
          path: './approval-details',
          importer: root + 'packages/extension-tasks/src/chat/actions/',
          contents: `export const ApprovalDetails=()=>null;`,
        },
        {
          path: '../../../runtime/connection/provider',
          importer: root + 'apps/mobile/src/',
          contents: `import {Effect} from 'effect';export const useRuntime=()=>({...window.store,callEffect:(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error})});`,
        },
        {
          path: '../../runtime/state/application-state',
          importer: root + 'apps/mobile/src/',
          contents: `import {useState,useRef} from 'react';export function useApplicationState(initial){const [v,set]=useState(initial);const ref=useRef(v);ref.current=v;return [v,set,ref]}`,
        },
        {
          path: '../../../ui/controls/action',
          importer: root + 'apps/mobile/src/',
          contents: `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
        },
        {
          path: '../../../ui/content/text',
          importer: root + 'apps/mobile/src/',
          contents: `export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;`,
        },
        {
          path: '../../../ui/theme',
          importer: root + 'apps/mobile/src/',
          contents: `export const useTheme=()=>({styles:{error:{},muted:{}}});`,
        },
        {
          path: 'react-native',
          contents: `export const View=({children})=><div>{children}</div>;`,
        },
      ].filter((stub) =>
        mobile
          ? !stub.path.startsWith('@dovo/studio-') && stub.path !== './approval-details'
          : stub.path.startsWith('@dovo/studio-') || stub.path === './approval-details',
      ),
    )
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    for (const error of [
      'Exceeded retry limit, last status: 429 Too Many Requests',
      'Provider connection closed unexpectedly',
    ]) {
      await page.evaluate((error) => window.update({ task: { error } }), error)
      await page.getByRole('alert').filter({ hasText: error }).waitFor()
      const count = await page.evaluate(() => window.requests.length)
      await retry.click()
      await page.getByRole('button', { name: 'Retrying…' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Retrying…' }).isDisabled(), true)
      assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), {
        path: '/api/tasks/retry-failed',
        input: { id: 'task' },
      })
      await page.evaluate(() => window.resolveRequest({ ok: true }))
      await retry.waitFor()
      assert.equal(await page.evaluate(() => window.requests.length), count + 1)
      assert.equal(await page.evaluate(() => window.current.draft), 'Keep draft')
      assert.equal(await page.evaluate(() => window.current.queue[0].text), 'Keep queued')
    }
    await retry.click()
    await page.evaluate(() => window.rejectRequest())
    await page.getByRole('alert').filter({ hasText: 'Retry connection failed' }).waitFor()
    await page.evaluate(() => window.update({ connected: false }))
    await page.waitForFunction(() => document.querySelector('button')?.disabled)
    await page.evaluate(() =>
      window.update({ connected: true, task: { status: 'running', error: undefined } }),
    )
    await retry.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} failed retry: 429/general failures, explicit requests, pending/offline states, errors and draft/queue preservation passed.`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
