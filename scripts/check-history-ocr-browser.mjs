import assert from 'node:assert/strict'
import { bundleBrowser, chromium } from './browser/harness.mjs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { RemoteBrowsers } from '../packages/runtime/dist/previews/browser.js'

const root = new URL('../', import.meta.url).pathname
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/extension-tasks',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {TooltipProvider} from '@dovo/studio-ui';
import {BrowserHistoryButton} from './src/browser/browser-history-button';import {ImageOcr} from './src/chat/composer/image-ocr';
window.steps=[];window.jumps=[];window.attached=[];window.calls=[];window.ocr='SAVE CHANGES';
window.historyFixture={currentIndex:2,entries:[{id:1,title:'First page',url:'http://lan.test/first'},{id:2,title:'Second page',url:'https://example.test/second'},{id:3,title:'Current page',url:'https://example.test/current'},{id:4,title:'Next page',url:'https://example.test/next'}]};
window.request=async(path,input)=>{window.calls.push({path,input});if(path==='/api/attachments/ocr'){if(window.holdOcr)await new Promise(resolve=>window.releaseOcr=resolve);if(window.failOcr)throw Error('Local vision is busy');return {text:window.ocr}};return {attachment:{id:input.id,name:'button.png',mime:'image/png',size:68},data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}};
function App(){const [file,setFile]=useState('image');window.switchImage=()=>setFile(current=>current==='image'?'another':'image');return <TooltipProvider>
{['back','forward'].map(direction=><BrowserHistoryButton key={direction} direction={direction} disabled={false} navigate={()=>window.steps.push(direction)} loadHistory={async()=>window.historyFixture} jump={async entry=>{if(window.stale)throw Error('Browser history changed');window.jumps.push(entry)}}/>)}
<ImageOcr taskId="task" file={{id:file,name:'button.png',mime:'image/png',size:68}} attachText={async(text,name)=>window.attached.push({text,name})}/>
<textarea aria-label="Message" defaultValue="Keep my draft"/></TooltipProvider>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>({connected:true,request:window.request});`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `
export {Button} from '${root}packages/studio-ui/src/components/ui/button';
export {IconButton} from '${root}packages/studio-ui/src/components/icon-button';
export * from '${root}packages/studio-ui/src/components/ui/dialog';
export {TooltipProvider} from '${root}packages/studio-ui/src/components/ui/tooltip';
export * as Popover from '${root}packages/studio-ui/node_modules/@radix-ui/react-popover';`,
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
  const back = page.getByRole('button', { name: 'Back', exact: true })
  await back.click()
  assert.deepEqual(await page.evaluate(() => window.steps), ['back'])
  await back.hover()
  await page.mouse.down()
  const menu = page.getByRole('menu', { name: 'Back history' })
  await menu.getByRole('menuitem', { name: /Second page/ }).waitFor()
  await page.mouse.up()
  assert.deepEqual(
    await page.evaluate(() => window.steps),
    ['back'],
    'Holding does not navigate one page',
  )
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), [
    'Second pagehttps://example.test/second',
    'First pagehttp://lan.test/first',
  ])
  await menu.getByRole('menuitem', { name: /First page/ }).click()
  assert.equal(await page.evaluate(() => window.jumps.at(-1).id), 1)
  await page.getByRole('button', { name: 'Forward', exact: true }).click({ button: 'right' })
  await page
    .getByRole('menu', { name: 'Forward history' })
    .getByRole('menuitem', { name: /Next page/ })
    .click()
  assert.equal(await page.evaluate(() => window.jumps.at(-1).id), 4)
  await back.focus()
  await back.press('Alt+ArrowDown')
  await menu.waitFor()
  await menu.press('ArrowDown')
  assert.match(await page.locator(':focus').textContent(), /Second page/)
  await menu.press('End')
  assert.match(await page.locator(':focus').textContent(), /First page/)
  await page.evaluate(() => (window.stale = true))
  await menu.getByRole('menuitem', { name: /First page/ }).click()
  await menu.getByRole('alert').filter({ hasText: 'Browser history changed' }).waitFor()
  await page.keyboard.press('Escape')
  const ocr = page.getByRole('button', { name: 'Extract text from button.png' })
  await ocr.click()
  const text = page.getByRole('textbox', { name: 'Extracted text' })
  await text.waitFor()
  assert.equal(await text.inputValue(), 'SAVE CHANGES')
  await text.fill('Save these changes')
  await page.getByRole('button', { name: 'Attach text file' }).click()
  assert.deepEqual(await page.evaluate(() => window.attached), [
    { text: 'Save these changes', name: 'button-ocr.txt' },
  ])
  assert.equal(
    await page.getByRole('textbox', { name: 'Message', exact: true }).inputValue(),
    'Keep my draft',
  )
  await page.evaluate(() => {
    window.switchImage()
    window.holdOcr = true
  })
  await ocr.click()
  await page.getByRole('status').filter({ hasText: 'Extracting text' }).waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).first().click()
  await page.evaluate(() => {
    window.switchImage()
    window.releaseOcr()
  })
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}

// Exercise actual Chromium history on a paired-computer browser session.
const directory = await mkdtemp(join(tmpdir(), 'dovo-history-browser-'))
const site = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<title>${request.url}</title>History fixture`)
})
site.listen(0, '127.0.0.1')
await once(site, 'listening')
const base = `http://127.0.0.1:${site.address().port}`
const remote = new RemoteBrowsers(directory)
let detach
let state
const waitForState = async (predicate) => {
  for (let index = 0; index < 100; index++) {
    if (predicate(state)) return
    await delay(50)
  }
  throw Error('Remote history state did not arrive')
}
try {
  await remote.open('history', 'history-thread', 'default', base + '/first')
  detach = await remote.attach('history', (message) => {
    if (message.type === 'state') state = message
  })
  for (const path of ['/second', '/third'])
    await remote.input('history', { type: 'navigate', url: base + path })
  await waitForState(
    (value) =>
      value?.title === '/third' &&
      value.navigationHistory?.entries.some((entry) => entry.url === base + '/first'),
  )
  const target = state.navigationHistory.entries.find((entry) => entry.url === base + '/first')
  await remote.input('history', { type: 'navigate-history', id: target.id, url: target.url })
  await waitForState((value) => value?.title === '/first' && value.forward)
  await assert.rejects(
    remote.input('history', { type: 'navigate-history', id: target.id, url: base + '/stale' }),
    /history changed/,
  )
  await remote.input('history', { type: 'forward' })
  await waitForState((value) => value?.title === '/second')
} finally {
  detach?.()
  await remote.dispose()
  await new Promise((resolve) => site.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
console.log(
  'Browser hold, context and keyboard history menus, real remote history jumps, OCR preview and text attachment passed.',
)
