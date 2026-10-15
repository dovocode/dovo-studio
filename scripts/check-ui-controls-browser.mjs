import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `
      import {createRoot} from 'react-dom/client';
      import {useState} from 'react';
      import {Select, SelectTrigger, SelectValue, SelectContent, SelectItem} from './src/components/ui/select';
      import {Input} from './src/components/ui/input';
      import {Button} from './src/components/ui/button';
      import {ChoicePicker} from './src/choice-picker';
      function App(){const [value,setValue]=useState('theme-0');return <main style={{padding:24}}>
        <Input aria-label="Path" className="font-mono text-xs md:text-xs" defaultValue="/work/project"/>
        <Button className="font-medium">Medium weight</Button>
        <Select value={value} onValueChange={setValue}><SelectTrigger aria-label="Theme"><SelectValue/></SelectTrigger>
          <SelectContent>{Array.from({length:30},(_,i)=><SelectItem key={i} value={'theme-'+i}>Theme {i}</SelectItem>)}</SelectContent>
        </Select>
        <ChoicePicker aria-label="Computer" value="one" onValueChange={()=>{}}><option value="one">Computer one</option></ChoicePicker>
      </main>};createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir: root + 'packages/studio-ui',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [840, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 560 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://localhost/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html class="dark"><body><div id="app"></div></body></html>',
      }),
    )
    await page.goto('http://localhost/')
    const assets = root + 'apps/desktop/dist/assets/'
    for (const file of readdirSync(assets).filter((file) => file.endsWith('.css'))) {
      await page.addStyleTag({ content: readFileSync(assets + file, 'utf8') })
    }
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const style = await page.getByRole('textbox', { name: 'Path' }).evaluate((input) => {
      const css = getComputedStyle(input)
      return { family: css.fontFamily, size: css.fontSize }
    })
    assert.match(style.family, /mono/i)
    assert.equal(style.size, '12px')
    assert.equal(
      await page
        .getByRole('button', { name: 'Medium weight' })
        .evaluate((el) => getComputedStyle(el).fontWeight),
      '500',
    )
    await page.getByRole('combobox', { name: 'Theme' }).click()
    const menu = page.getByRole('listbox')
    await menu.waitFor()
    // Wait for Radix positioning and opening animation before measuring.
    await page.waitForFunction(() => {
      const el = document.querySelector('[role="listbox"]')
      return el && getComputedStyle(el).maxHeight !== 'none'
    })
    const rect = await menu.boundingBox()
    assert.ok(rect.y >= 0 && rect.y + rect.height <= 560, JSON.stringify(rect))
    await page.keyboard.press('End')
    await page.getByRole('option', { name: 'Theme 29', exact: true }).evaluate(
      (option) =>
        new Promise((resolve, reject) => {
          let attempts = 0
          const check = () => {
            if (document.activeElement === option) resolve()
            else if (++attempts > 60) reject(new Error('End did not focus the last option'))
            else requestAnimationFrame(check)
          }
          check()
        }),
    )
    await page.keyboard.press('Enter')
    await page.getByRole('combobox', { name: 'Theme' }).filter({ hasText: 'Theme 29' }).waitFor()
    await page.getByRole('button', { name: 'Computer', exact: true }).click()
    const search = page.getByRole('combobox', { name: 'Search computer' })
    await search.waitFor()
    const offset = await search.evaluate((input) => {
      const icon = input.parentElement.querySelector('svg').getBoundingClientRect()
      const field = input.getBoundingClientRect()
      return Math.abs(icon.y + icon.height / 2 - field.y - field.height / 2)
    })
    assert.ok(offset < 1, `Search icon center offset: ${offset}`)
    await search.fill('no matching computer')
    await page.getByText('No matching options.').waitFor()
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Shared controls: constrained select with keyboard access, control typography, centered searchable picker passed at 840px and 390px.',
  )
} finally {
  await browser.close()
}
