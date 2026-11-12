import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {WorkspaceContext} from './packages/studio-core/src/workspace/context';
import {CommitBar} from './packages/extension-tasks/src/review/commit-bar';
import {ReviewFeedback} from './packages/extension-tasks/src/review/review-feedback';
import {createDetailDrafts,useDetailDraft,detailDraftKey} from './apps/mobile/src/runtime/state/detail-drafts';
const cache=createDetailDrafts({isClean:d=>!d.message});const connection={address:'http://host',token:'test'};
window.pending=[];const request=(path,input)=>new Promise((resolve,reject)=>window.pending.push({path,input,resolve,reject}));
function Mobile({scope}){const key=detailDraftKey(connection,'commit',scope);const{draft,setField,clear}=useDetailDraft(cache,key,()=>({message:''}));window.mobileSave=()=>{const submitted=cache.read(key);window.finishMobile=()=>{if(cache.read(key)===submitted)setField('message','')}};window.mobileClear=clear;return <textarea aria-label="Mobile commit" value={draft.message} onChange={e=>setField('message',e.target.value)}/>}
function App(){const[shown,show]=useState(true);const[scope,setScope]=useState('a');const[file,setFile]=useState('one.ts');const[token,setToken]=useState('test');window.show=value=>flushSync(()=>show(value));window.scope=value=>flushSync(()=>setScope(value));window.file=value=>flushSync(()=>setFile(value));window.token=value=>flushSync(()=>setToken(value));const task={id:scope,repositoryId:'repo',status:'review',files:[{}],messages:[]};return <WorkspaceContext.Provider value={{connection:{...connection,token},workspace:{repositories:[{id:'repo',path:'/repo'}]},request,connected:true}}>{shown&&<><CommitBar task={task}/><ReviewFeedback task={task} file={{path:file}}/><Mobile scope={scope}/></>}</WorkspaceContext.Provider>};createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { react: root + 'packages/studio-ui/node_modules/react' },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {useWorkspace} from '${root}packages/studio-core/src/workspace/context';export {updateTask} from '${root}packages/studio-core/src/workspace/actions';`,
    },
    {
      path: '@dovo/studio-ui',
      contents:
        'export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const Textarea=props=><textarea {...props}/>;',
    },
    {
      path: 'react-native',
      contents: 'export const Alert={alert:message=>{throw Error(message)}};',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const commit = page.getByRole('textbox', { name: 'Commit message', exact: true }),
    feedback = page.getByRole('textbox', { name: 'File feedback' }),
    mobile = page.getByRole('textbox', { name: 'Mobile commit' })
  await commit.fill('Keep commit')
  await feedback.fill('One file')
  await mobile.fill('Mobile draft')
  await page.evaluate(() => {
    window.show(false)
    window.show(true)
  })
  assert.equal(await commit.inputValue(), 'Keep commit')
  assert.equal(await feedback.inputValue(), 'One file')
  assert.equal(await mobile.inputValue(), 'Mobile draft')
  await page.evaluate(() => window.file('two.ts'))
  assert.equal(await feedback.inputValue(), '')
  await feedback.fill('Second file')
  await page.evaluate(() => window.file('one.ts'))
  assert.equal(await feedback.inputValue(), 'One file')
  await page.evaluate(() => window.scope('b'))
  assert.equal(await commit.inputValue(), '')
  assert.equal(await mobile.inputValue(), '')
  await commit.fill('Other thread')
  await page.evaluate(() => window.scope('a'))
  assert.equal(await commit.inputValue(), 'Keep commit')
  await page.evaluate(() => window.token('replacement'))
  assert.equal(await commit.inputValue(), '')
  await page.evaluate(() => window.token('test'))
  assert.equal(await commit.inputValue(), 'Keep commit')
  // Success after unmount clears only the submitted draft, including a remounted subscriber.
  await page.getByRole('button', { name: 'Commit all', exact: true }).click()
  await page.evaluate(() => {
    window.show(false)
    window.show(true)
  })
  await commit.fill('New edit during old request')
  await page.evaluate(() => window.pending.shift().resolve({ commit: 'abc123456' }))
  assert.equal(await commit.inputValue(), 'New edit during old request')
  await page.getByRole('button', { name: 'Commit all', exact: true }).click()
  await page.evaluate(() => {
    window.show(false)
    window.show(true)
    window.pending.shift().resolve({ commit: 'def123456' })
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Commit message"]').value === '',
  )
  // A generated reply cannot replace text entered in a remounted panel.
  await page.getByRole('button', { name: 'Write the commit message' }).click()
  await page.evaluate(() => {
    window.show(false)
    window.show(true)
  })
  await commit.fill('User wrote this')
  await page.evaluate(() => window.pending.shift().resolve({ message: 'Generated' }))
  assert.equal(await commit.inputValue(), 'User wrote this')
  // Failed requests keep text across closing and reopening the tray.
  await page.getByRole('button', { name: 'Commit all', exact: true }).click()
  await page.evaluate(() => window.pending.shift().reject(Error('Commit failed')))
  await page.getByRole('status').filter({ hasText: 'Commit failed' }).waitFor()
  await page.evaluate(() => {
    window.show(false)
    window.show(true)
  })
  assert.equal(await commit.inputValue(), 'User wrote this')
  await page.evaluate(() => window.mobileSave())
  await page.evaluate(() => {
    window.show(false)
    window.show(true)
  })
  await mobile.fill('New mobile edit')
  await page.evaluate(() => window.finishMobile())
  assert.equal(await mobile.inputValue(), 'New mobile edit')
  await page.evaluate(() => {
    window.mobileSave()
    window.show(false)
    window.show(true)
    window.finishMobile()
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Mobile commit"]').value === '',
  )
  await commit.fill('Same draft')
  await page.getByRole('button', { name: 'Commit all', exact: true }).click()
  await page.evaluate(() => {
    window.show(false)
    window.show(true)
  })
  await commit.fill('Changed draft')
  await commit.fill('Same draft')
  await page.evaluate(() => window.pending.shift().resolve({ commit: 'abc123456' }))
  assert.equal(
    await commit.inputValue(),
    'Same draft',
    'Old success cleared a new revision with the same text',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Changes drafts: tray remount, file/thread/pairing scopes, delayed generation, commit success/failure and mobile cache acknowledgements passed.',
  )
} finally {
  await browser.close()
}
