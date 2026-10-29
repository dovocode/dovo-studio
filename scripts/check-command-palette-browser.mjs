import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: `${root}packages/studio-ui`,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {CommandPalette} from '../studio-shell/src/command-palette';
window.executed=[];
const definitions=[
  {id:'workspace',title:'Open workspace',aliases:['thread','thread']},
  {id:'new',title:'New thread',aliases:['new task','new chat','thread']},
  {id:'switch',title:'Go to task…',aliases:['go to thread','switch thread']},
  {id:'search',title:'Search conversations…',aliases:['search messages','find message','thread']},
  {id:'history',title:'Thread history',aliases:['thread']},
  {id:'terminal',title:'Toggle terminal',aliases:['shell','console']},
  {id:'appearance',title:'Open Appearance',aliases:['fonts typography themes']},
];
function App(){const[open,setOpen]=useState(false),[commands,setCommands]=useState(definitions);window.setCommands=setCommands;
return <><button onClick={()=>setOpen(true)}>Open commands</button><main className="studio-main" tabIndex={-1}>Workspace</main><CommandPalette open={open} onOpenChange={setOpen} commands={commands.map(command=>({...command,run:()=>window.executed.push(command.id)}))}/></>}
createRoot(document.getElementById('app')).render(<App/>);`,
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
      path: '@dovo/studio-core/state',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '@dovo/studio-ui',
      contents: `
export * from './src/components/ui/dialog';
export {Input} from './src/components/ui/input';
export {Button} from './src/components/ui/button';`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  const screenshots = process.env.DOVO_COMMAND_SCREENSHOTS
  if (screenshots) {
    await mkdir(screenshots, { recursive: true })
    const assets = `${root}apps/desktop/dist/assets/`
    for (const file of await readdir(assets))
      if (file.endsWith('.css'))
        await page.addStyleTag({ content: await readFile(assets + file, 'utf8') })
  } else
    await page.addStyleTag({
      content:
        '[role=dialog]{position:fixed;inset:80px 120px;background:white;padding:20px}[role=listbox]{max-height:300px;overflow:auto}[role=option]{display:block;width:100%;text-align:left}[role=dialog]>div{margin:8px}',
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const opener = page.getByRole('button', { name: 'Open commands', exact: true })
  const input = page.getByRole('combobox', { name: 'Search commands', exact: true })
  const options = page.getByRole('option')
  const titles = () => options.allTextContents()
  await opener.click()
  await input.waitFor()
  assert.equal(await input.evaluate((element) => element === document.activeElement), true)
  if (screenshots) {
    await page.getByRole('dialog').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    await page.screenshot({ path: screenshots + '/commands-desktop.png' })
    await page.setViewportSize({ width: 320, height: 700 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.evaluate(() => {
      document.documentElement.dataset.themeGlow = '0'
      document.documentElement.dataset.themeGradients = 'false'
    })
    assert.equal(
      await options.first().evaluate((el) => getComputedStyle(el).backgroundImage),
      'none',
    )
    await page.screenshot({ path: screenshots + '/commands-320-flat.png' })
    await page.setViewportSize({ width: 900, height: 800 })
  }
  const declarationOrder = await titles()
  assert.equal(declarationOrder.length, 7)
  await input.fill('  ThReAd  ')
  assert.deepEqual(await titles(), [
    'New thread',
    'Thread history',
    'Open workspace',
    'Go to task…',
    'Search conversations…',
  ])
  assert.equal(await options.filter({ hasText: /^New thread$/ }).count(), 1)
  assert.equal(await options.filter({ hasText: /^Open workspace$/ }).count(), 1)
  await input.press('End')
  assert.equal(await input.getAttribute('aria-activedescendant'), 'command-option-4')
  await input.press('Home')
  await input.press('ArrowDown')
  assert.equal(
    await options.filter({ hasText: /^Thread history$/ }).getAttribute('aria-selected'),
    'true',
  )
  await input.press('ArrowUp')
  await input.press('Enter')
  await input.waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.executed), ['new'])
  await page.waitForFunction(() => document.activeElement?.matches('.studio-main'))
  await opener.click()
  await input.fill('  NEW TASK  ')
  assert.deepEqual(await titles(), ['New thread'])
  await input.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  assert.deepEqual(await page.evaluate(() => window.executed), ['new'])
  assert.equal(await input.isVisible(), true)
  await input.press('Enter')
  await input.waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.executed), ['new', 'new'])
  await opener.click()
  await input.fill('  ')
  assert.deepEqual(await titles(), declarationOrder)
  await input.fill('fonts')
  assert.deepEqual(await titles(), ['Open Appearance'])
  await input.fill('no-command-can-match-this')
  await page.getByText('No matching commands.', { exact: true }).waitFor()
  assert.equal(await input.getAttribute('aria-activedescendant'), null)
  await input.press('End')
  await input.press('ArrowDown')
  await input.press('Enter')
  assert.deepEqual(await page.evaluate(() => window.executed), ['new', 'new'])
  await input.press('Escape')
  await input.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.textContent === 'Open commands')
  await opener.click()
  assert.equal(await input.inputValue(), '', 'Closing resets the search')
  await input.fill('console')
  await options.filter({ hasText: /^Toggle terminal$/ }).click()
  await input.waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.executed), ['new', 'new', 'terminal'])
  assert.deepEqual(errors, [])
  console.log(
    'Command palette: trimmed/case-insensitive aliases, stable title-first ranking, duplicate-match suppression, keyboard/mouse execution, IME, empty results and focus restoration passed.',
  )
} finally {
  await browser.close()
}
