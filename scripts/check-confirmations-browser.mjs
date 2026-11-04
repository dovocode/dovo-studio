import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/studio-ui',
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkspaceContext} from '../studio-core/src/workspace/context';
import {useConfirmation} from '../studio-core/src/confirmation';
import {StudioConfirmationProvider} from './src/confirmation-provider';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './src/components/ui/dialog';
window.decisions=[];window.writes=[];
const options={title:'Delete selected threads?',description:'This cannot be undone. Working files follow the captured computer’s cleanup setting.',confirmLabel:'Delete threads',destructive:true};
function Actions(){
 const [contextKey,setContextKey]=useState('initial');window.changeContext=setContextKey;const confirm=useConfirmation(contextKey);const [editing,setEditing]=useState(false);const [draft,setDraft]=useState('Keep this draft');
 const decide=async(value=options)=>{const accepted=await confirm(value);window.decisions.push(accepted);if(accepted)window.writes.push(value.title)};
 window.askBatch=()=>{void decide({...options,title:'First decision?'});void decide({...options,title:'Second decision?',details:JSON.stringify({message:'Review the complete request',suffix:'END_OF_REQUEST'},null,2)})};
 return <><button onClick={()=>void decide()}>Delete threads trigger</button><button onClick={()=>setEditing(true)}>Edit draft</button>{editing&&<Dialog open onOpenChange={setEditing}><DialogContent><DialogHeader><DialogTitle>Edit draft</DialogTitle><DialogDescription>Unsaved edits remain until you choose to discard them.</DialogDescription></DialogHeader><input aria-label="Draft" value={draft} onChange={e=>setDraft(e.target.value)}/><button onClick={async()=>{if(await confirm({title:'Discard draft?',description:'Your unsaved changes will be lost.',confirmLabel:'Discard changes',destructive:true}))setEditing(false)}}>Discard draft</button></DialogContent></Dialog>}</>;
}
function App(){
 const [scope,setScope]=useState('a'),[caller,setCaller]=useState(true),[provider,setProvider]=useState(true);
 window.changeScope=setScope;window.showCaller=setCaller;window.showProvider=setProvider;
 return <WorkspaceContext.Provider value={{activeRuntimeId:scope,connection:{address:'http://'+scope,token:'paired'}}}>{provider&&<StudioConfirmationProvider>{caller&&<Actions/>}</StudioConfirmationProvider>}</WorkspaceContext.Provider>;
}
createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: "export {ConfirmationContext} from '../studio-core/src/confirmation';",
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
    reducedMotion: 'reduce',
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<html data-motion="system"><body><div id="app"></div></body></html>')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const trigger = page.getByRole('button', { name: 'Delete threads trigger', exact: true })
  const dialog = (title) => page.getByRole('dialog', { name: title, exact: true })
  const decisions = () => page.evaluate(() => window.decisions)
  for (const mode of ['dark', 'light']) {
    await page.evaluate((mode) => {
      document.documentElement.classList.toggle('dark', mode === 'dark')
      document.documentElement.dataset.theme = mode
    }, mode)
    await trigger.click()
    const prompt = dialog('Delete selected threads?')
    await prompt.waitFor()
    assert.equal(
      await prompt
        .getByRole('button', { name: 'Cancel', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    )
    await page.keyboard.press('Escape')
    await prompt.waitFor({ state: 'hidden' })
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'Delete threads trigger',
    )
    assert.equal(await trigger.evaluate((el) => el === document.activeElement), true)
    assert.equal((await decisions()).at(-1), false)
    await trigger.click()
    await prompt.getByRole('button', { name: 'Delete threads', exact: true }).click()
    await prompt.waitFor({ state: 'hidden' })
    assert.equal((await decisions()).at(-1), true)
  }
  const before = await page.evaluate(() => window.writes.length)
  await trigger.click()
  await page.evaluate(() => window.changeScope('b'))
  await dialog('Delete selected threads?').waitFor({ state: 'hidden' })
  assert.equal((await decisions()).at(-1), false)
  assert.equal(await page.evaluate(() => window.writes.length), before)
  await trigger.click()
  await page.evaluate(() => window.changeContext('different draft'))
  await dialog('Delete selected threads?').waitFor({ state: 'hidden' })
  assert.equal((await decisions()).at(-1), false)
  assert.equal(await page.evaluate(() => window.writes.length), before)
  await trigger.click()
  await page.evaluate(() => window.showCaller(false))
  await dialog('Delete selected threads?').waitFor({ state: 'hidden' })
  assert.equal((await decisions()).at(-1), false)
  assert.equal(await page.evaluate(() => window.writes.length), before)
  await page.evaluate(() => window.showCaller(true))
  await trigger.waitFor()
  await page.evaluate(() => window.askBatch())
  await dialog('First decision?').waitFor()
  assert.equal(await dialog('Second decision?').count(), 0)
  await dialog('First decision?').getByRole('button', { name: 'Cancel', exact: true }).click()
  await dialog('Second decision?').waitFor()
  assert.match(
    await dialog('Second decision?')
      .getByRole('region', { name: 'Details', exact: true })
      .innerText(),
    /END_OF_REQUEST/,
  )
  await dialog('Second decision?')
    .getByRole('button', { name: 'Delete threads', exact: true })
    .click()
  await page.waitForFunction(() => window.decisions.at(-1) === true)
  await page.getByRole('button', { name: 'Edit draft', exact: true }).click()
  await dialog('Edit draft').getByLabel('Draft', { exact: true }).fill('Preserve these changes')
  await dialog('Edit draft').getByRole('button', { name: 'Discard draft', exact: true }).click()
  await dialog('Discard draft?').waitFor()
  assert.equal(await page.locator('.dovo-dialog-overlay').count(), 2)
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.dovo-dialog-overlay')).backgroundColor ===
      'rgba(0, 0, 0, 0)',
  )
  const scrims = await page.locator('.dovo-dialog-overlay').evaluateAll((elements) =>
    elements.map((element) => ({
      color: getComputedStyle(element).backgroundColor,
      blur: getComputedStyle(element).backdropFilter,
    })),
  )
  assert.equal(scrims[0].color, 'rgba(0, 0, 0, 0)', 'Underlying scrim must not compound dimming')
  assert.equal(scrims[0].blur, 'none', 'Only the front modal blurs the backdrop')
  assert.equal(scrims[1].color, 'rgba(0, 0, 0, 0.28)', 'Light theme keeps context visible')
  await dialog('Discard draft?').getByRole('button', { name: 'Cancel', exact: true }).click()
  await dialog('Discard draft?').waitFor({ state: 'hidden' })
  assert.equal(
    await dialog('Edit draft').getByLabel('Draft', { exact: true }).inputValue(),
    'Preserve these changes',
  )
  await page.waitForFunction(() => document.activeElement?.textContent === 'Discard draft')
  assert.equal(
    await dialog('Edit draft')
      .getByRole('button', { name: 'Discard draft', exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  )
  await dialog('Edit draft').getByRole('button', { name: 'Discard draft', exact: true }).click()
  await dialog('Discard draft?')
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click()
  await dialog('Edit draft').waitFor({ state: 'hidden' })
  await trigger.click()
  await page.evaluate(() => window.showProvider(false))
  await dialog('Delete selected threads?').waitFor({ state: 'hidden' })
  assert.equal((await decisions()).at(-1), false)
  assert.deepEqual(errors, [])
  console.log(
    'Themed confirmations: Cancel focus, Escape/return focus, accept, queued/full details, nested draft preservation, runtime/context/caller/provider cancellation pass.',
  )
} finally {
  await browser.close()
}
