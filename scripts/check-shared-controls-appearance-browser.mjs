import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
      import {createRoot} from 'react-dom/client';
      import {studioThemes} from '../studio-core/src/themes';
      import {accessibleThemeColors} from '../studio-core/src/accessibility';
      import {Button} from '../web-ui/src/button';
      import {Input} from '../web-ui/src/input';
      import {Textarea} from '../web-ui/src/textarea';
      import {Card} from '../web-ui/src/card';
      import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '../web-ui/src/select';
      import {Checkbox} from './src/components/ui/checkbox';
      import {Switch} from './src/components/ui/switch';
      window.palettes=studioThemes;window.colors=accessibleThemeColors;
      createRoot(document.getElementById('app')).render(<main className="p-6 space-y-4"><Card className="space-y-4"><div className="studio-menu-surface bg-transparent" data-test="menu-override">Custom surface</div><div className="flex gap-2"><Button>Save</Button><Button variant="ghost">Ghost</Button><Button size="icon" aria-label="Icon">+</Button><Button disabled>Disabled</Button></div><Input aria-label="Field"/><Input aria-label="Custom" className="bg-transparent"/><Input aria-label="Invalid" aria-invalid="true"/><Textarea aria-label="Notes"/><Select defaultValue="one"><SelectTrigger aria-label="Choice"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem><SelectItem value="two">Two</SelectItem></SelectContent></Select><select aria-label="Native"><option>Native option</option></select><div className="flex gap-4"><Checkbox aria-label="Check" defaultChecked/><Switch aria-label="Switch" defaultChecked/></div></Card></main>);
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
  },
  [],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 700 } })
  await page.route('http://localhost/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div id="app"></div></body></html>',
    }),
  )
  await page.goto('http://localhost/')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const [palette, mode, effects] of [
    ['dovo', 'dark', true],
    ['iris', 'dark', false],
    ['dovo', 'light', true],
    ['dovo', 'dark', false],
  ]) {
    await page.evaluate(
      ({ palette, mode, effects }) => {
        const root = document.documentElement
        root.dataset.theme = mode
        root.dataset.themeGradients = String(effects)
        root.dataset.themeGlow = effects ? '1' : '0'
        root.style.setProperty('--studio-glow-strength', effects ? '1' : '0')
        root.classList.toggle('dark', mode === 'dark')
        for (const [name, value] of Object.entries(
          window.colors(window.palettes[palette][mode], mode, false),
        ))
          root.style.setProperty('--' + name, value)
      },
      { palette, mode, effects },
    )
    const style = (selector, property) =>
      page
        .locator(selector)
        .first()
        .evaluate((el, property) => getComputedStyle(el)[property], property)
    assert.equal(await style('[data-test="menu-override"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.equal(await style('[aria-label="Custom"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.notEqual(await style('[aria-label="Field"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.equal(await style('[data-variant="ghost"]', 'backgroundImage'), 'none')
    assert.equal(await style('[data-size="icon"]', 'backgroundImage'), 'none')
    assert.equal((await style('[data-variant="default"]', 'backgroundImage')) === 'none', !effects)
    assert.equal((await page.getByRole('button', { name: 'Save' }).boundingBox()).height, 32)
    assert.notEqual(
      await style('[aria-label="Native"] option', 'backgroundColor'),
      'rgba(0, 0, 0, 0)',
    )
    for (const control of ['Check', 'Switch']) {
      assert.equal(await page.getByLabel(control).getAttribute('data-state'), 'checked')
      assert.equal(
        (await style(`[aria-label="${control}"]`, 'boxShadow')).includes('0px 0px 14px'),
        effects,
      )
    }
    await page.getByRole('combobox', { name: 'Choice' }).click()
    assert.equal(
      await page
        .locator('[data-slot="select-content"]')
        .evaluate((el) => el.classList.contains('studio-menu-surface')),
      true,
    )
    assert.equal(
      (await style('[data-slot="select-content"]', 'boxShadow')).includes('36px'),
      effects,
    )
    assert.equal(
      (await style('[data-slot="select-item"][data-state="checked"]', 'backgroundImage')) ===
        'none',
      !effects,
    )
    await page.screenshot({
      path: `/tmp/dovo-controls-${palette}-${mode}-${effects ? 'effects' : 'flat'}.png`,
    })
    await page.keyboard.press('Escape')
  }
  await page.emulateMedia({ forcedColors: 'active' })
  await page.getByRole('combobox', { name: 'Choice' }).click()
  assert.equal(
    await page
      .locator('[data-slot="select-item"][data-state="checked"]')
      .evaluate((el) => getComputedStyle(el).color),
    'rgb(255, 255, 255)',
  )
  console.log('Shared controls appearance checks passed')
} finally {
  await browser.close()
}
