import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = new URL('../', import.meta.url).pathname
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useWorkDraftText,clearWorkDraft} from '${root}packages/extension-scm/src/work/work-drafts';
import {useTaskWaiting} from '${root}packages/studio-core/src/use-task-waiting';
import {useLiveRefreshState} from './src/detail/live-refresh';
import {BackgroundRefreshProvider,BackgroundRefreshIssue,BackgroundRefreshNotice} from './src/detail/background-refresh-notice';
window.fields={};window.fail={Changes:true,Git:true,Watching:true};window.reads={};
function Field({id}){const [value,set]=useWorkDraftText(id,'title','Default');window.fields[id]=set;return <input aria-label={id} value={value} onChange={event=>set(event.target.value)}/>}
function Forms(){const [count,setCount]=useState(230);const [epoch,setEpoch]=useState(0);window.remount=()=>{setCount(1);setEpoch(value=>value+1)};return <><button onClick={()=>{clearWorkDraft('draft-0');setEpoch(value=>value+1)}}>Clear saved form</button>{Array.from({length:count},(_,index)=><Field key={epoch+':'+index} id={'draft-'+index}/>)}</>}
async function read(label){window.reads[label]=(window.reads[label]??0)+1;if(window.fail[label])throw new Error(label+' unavailable')}
function Refresh({label}){const action=useCallback(()=>read(label),[label]);const {error,retry}=useLiveRefreshState(true,action);return <BackgroundRefreshIssue label={label} error={error} retry={retry}/>}
function Waiting(){const request=useCallback(async input=>{if(input.unlink)throw new Error('Stop watching failed');await read('Watching');return {dependencies:[],related:[]}},[]);const {refresh,refreshError,mutationError}=useTaskWaiting('thread',true,request,'runtime');const retry=useCallback(()=>refresh(),[refresh]);return <><BackgroundRefreshIssue label="Watching" error={refreshError} retry={retry}/><button onClick={()=>refresh({kind:'pull',repositoryId:'repo',target:'1'})}>Stop watching</button>{mutationError&&<p role="alert">{mutationError}</p>}</>}
function App(){const [show,setShow]=useState(true);return <><Forms/><BackgroundRefreshProvider>{show&&<><Refresh label="Changes"/><Refresh label="Git"/><Waiting/></>}<BackgroundRefreshNotice/></BackgroundRefreshProvider><button onClick={()=>setShow(false)}>Close thread</button></>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
  },
  [
    {
      path: '@dovo/studio-core/state',
      contents: "export {useState as useApplicationState} from 'react';",
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('textbox', { name: 'draft-229', exact: true }).waitFor()
  await page
    .getByRole('textbox', { name: 'draft-0', exact: true })
    .fill('Exact unsent text with details')
  await page.evaluate(() => {
    for (let i = 1; i < 230; i++) window.fields['draft-' + i]('Unsent text ' + i)
  })
  await page.evaluate(() => window.remount())
  assert.equal(
    await page.getByRole('textbox', { name: 'draft-0', exact: true }).inputValue(),
    'Exact unsent text with details',
  )
  await page.getByRole('button', { name: 'Clear saved form' }).click()
  assert.equal(
    await page.getByRole('textbox', { name: 'draft-0', exact: true }).inputValue(),
    'Default',
  )
  await page.getByText('Some information could not refresh. View details').waitFor()
  assert.equal(await page.getByRole('status').count(), 1)
  await page.locator('summary').click()
  for (const label of ['Changes', 'Git', 'Watching'])
    await page.getByText(label + ': ' + label + ' unavailable', { exact: true }).waitFor()
  if (process.env.DOVO_STABILITY_SCREENSHOT) {
    const assets = root + 'apps/desktop/dist/assets/'
    const css = (await readdir(assets)).find((name) => /^index-.*\.css$/.test(name))
    assert.ok(css, 'Build the desktop app before the visual check')
    await page.addStyleTag({ content: await readFile(assets + css, 'utf8') })
    await page.setViewportSize({ width: 360, height: 800 })
    const notice = page.getByRole('status')
    await notice.screenshot({ path: process.env.DOVO_STABILITY_SCREENSHOT })
    assert.ok(
      (await page.getByRole('button', { name: 'Retry', exact: true }).boundingBox()).x < 360,
    )
  }
  await page.evaluate(() => {
    window.fail.Changes = false
    window.fail.Watching = false
  })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page
    .getByText('Watching: Watching unavailable', { exact: true })
    .waitFor({ state: 'detached' })
  assert.equal(await page.locator('li').count(), 1)
  await page.getByRole('button', { name: 'Stop watching', exact: true }).click()
  await page.getByRole('alert').getByText('Stop watching failed', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.fail.Git = false
  })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.getByRole('status').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('alert').textContent(), 'Stop watching failed')
  await page.getByRole('button', { name: 'Close thread' }).click()
  assert.equal(await page.getByRole('status').count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    '230 unsent form fields survive remount; refresh failures share details and real Retry; failed Stop stays visible.',
  )
} finally {
  await browser.close()
}
