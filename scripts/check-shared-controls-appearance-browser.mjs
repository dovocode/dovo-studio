import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = process.argv[2] ?? '/tmp/dovo-shared-controls'
mkdirSync(output, { recursive: true })
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
      import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from '../web-ui/src/dialog';
      import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '../web-ui/src/select';
      import {ChoicePicker} from './src/choice-picker';
      import {Checkbox} from './src/components/ui/checkbox';
      import {Switch} from './src/components/ui/switch';
      window.palettes=studioThemes;window.colors=accessibleThemeColors;
      createRoot(document.getElementById('app')).render(<main className="p-6 space-y-4"><Card className="space-y-4"><div className="studio-menu-surface bg-transparent" data-test="menu-override">Custom surface</div><div className="flex gap-2"><Button>Save</Button><Button variant="ghost">Ghost</Button><Button size="icon" aria-label="Icon">+</Button><Button disabled>Disabled</Button></div><Input aria-label="Field"/><Input aria-label="Custom" className="bg-transparent"/><Input aria-label="Invalid" aria-invalid="true"/><Input aria-label="Rounded search" type="search" className="rounded-full" placeholder="Search"/><Input aria-label="Rounded URL" type="url" className="rounded-full" placeholder="http://localhost:3000"/><Textarea aria-label="Notes"/><Select defaultValue="one"><SelectTrigger aria-label="Choice"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem><SelectItem value="two">Two</SelectItem></SelectContent></Select><ChoicePicker aria-label="Computer" value="local" onValueChange={()=>{}}><option value="local">This computer</option></ChoicePicker><select aria-label="Native"><option>Native option</option></select><div className="flex gap-4"><Checkbox aria-label="Check" defaultChecked/><Switch aria-label="Switch" defaultChecked/></div><Dialog><DialogTrigger asChild><Button variant="outline">Open control dialog</Button></DialogTrigger><DialogContent><DialogTitle>Project settings</DialogTitle><DialogDescription>Shared controls in a production dialog.</DialogDescription><Input aria-label="Dialog name" defaultValue="Dovo Studio"/><Select defaultValue="one"><SelectTrigger aria-label="Dialog choice"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem></SelectContent></Select><div className="flex justify-end gap-2"><Button disabled>Unavailable action</Button><Button>Save project</Button></div></DialogContent></Dialog></Card></main>);
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
  const page = await browser.newPage({
    viewport: { width: 900, height: 1000 },
    reducedMotion: 'reduce',
  })
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
  for (const [palette, mode, effects, highContrast = false] of [
    ['dovo', 'dark', true],
    ['iris', 'dark', false],
    ['dovo', 'light', true],
    ['dovo', 'dark', false],
    ['dovo', 'light', false, true],
    ['dovo', 'dark', false, true],
  ]) {
    await page.evaluate(
      ({ palette, mode, effects, highContrast }) => {
        const root = document.documentElement
        root.dataset.theme = mode
        root.dataset.themeGradients = String(effects)
        root.dataset.themeGlow = effects ? '1' : '0'
        root.style.setProperty('--studio-glow-strength', effects ? '1' : '0')
        root.classList.toggle('dark', mode === 'dark')
        for (const [name, value] of Object.entries(
          window.colors(window.palettes[palette][mode], mode, highContrast),
        ))
          root.style.setProperty('--' + name, value)
      },
      { palette, mode, effects, highContrast },
    )
    const style = (selector, property) =>
      page
        .locator(selector)
        .first()
        .evaluate((el, property) => getComputedStyle(el)[property], property)
    assert.equal(await style('[data-test="menu-override"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.equal(await style('[aria-label="Custom"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.notEqual(await style('[aria-label="Field"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    for (const selector of [
      '[aria-label="Field"]',
      '[aria-label="Choice"]',
      '[aria-label="Computer"]',
    ])
      assert.equal(await style(selector, 'borderRadius'), '8px', `${selector}: control radius`)
    for (const label of ['Rounded search', 'Rounded URL'])
      assert.ok(
        parseFloat(await style(`[aria-label="${label}"]`, 'borderRadius')) > 32,
        `${label}: caller radius`,
      )
    const assertUnavailable = async (name, enabledName) => {
      const button = page.getByRole('button', { name, exact: true })
      const enabled = page.getByRole('button', { name: enabledName, exact: true })
      assert.equal(await button.isDisabled(), true)
      const unavailable = await button.evaluate((node) => {
        const css = getComputedStyle(node)
        return {
          fill: css.backgroundColor,
          image: css.backgroundImage,
          opacity: css.opacity,
          border: css.borderTopWidth,
          shadow: css.boxShadow,
        }
      })
      assert.equal(unavailable.opacity, '1', `${name}: retain control legibility`)
      assert.equal(unavailable.image, 'none')
      assert.equal(unavailable.shadow, 'none')
      assert.equal(unavailable.border, '1px')
      assert.notEqual(
        unavailable.fill,
        await enabled.evaluate((node) => getComputedStyle(node).backgroundColor),
        `${name}: unavailable surface differs from primary`,
      )
    }
    await assertUnavailable('Disabled', 'Save')
    const fieldContrast = await page.getByLabel('Field', { exact: true }).evaluate((element) => {
      const context = document.createElement('canvas').getContext('2d')
      const luminance = (color) => {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          })
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
      }
      const css = getComputedStyle(element)
      const border = luminance(css.borderColor)
      const fill = luminance(css.backgroundColor)
      return (Math.max(border, fill) + 0.05) / (Math.min(border, fill) + 0.05)
    })
    assert.ok(fieldContrast >= 3, `${palette} ${mode}: field boundary contrast ${fieldContrast}`)
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
    const toggle = page.getByRole('switch', { name: 'Switch' })
    await toggle.click()
    await toggle.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    )
    const offContrast = await toggle.evaluate((element) => {
      const luminance = (color) => {
        const channels = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          })
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
      }
      const border = luminance(getComputedStyle(element).borderColor)
      const surface = luminance(
        getComputedStyle(element.closest('[data-slot="card"]')).backgroundColor,
      )
      return (Math.max(border, surface) + 0.05) / (Math.min(border, surface) + 0.05)
    })
    assert.ok(
      offContrast >= 3,
      `${palette} ${mode}: unchecked switch boundary contrast ${offContrast}`,
    )
    await toggle.click()
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
      path: `${output}/${palette}-${mode}-${highContrast ? 'contrast' : effects ? 'effects' : 'flat'}-select.png`,
    })
    await page.keyboard.press('Escape')
    await page.screenshot({
      path: `${output}/${palette}-${mode}-${highContrast ? 'contrast' : effects ? 'effects' : 'flat'}-main.png`,
    })
    await page.getByRole('button', { name: 'Open control dialog' }).click()
    await assertUnavailable('Unavailable action', 'Save project')
    for (const label of ['Dialog name', 'Dialog choice'])
      assert.equal(await style(`[aria-label="${label}"]`, 'borderRadius'), '8px')
    await page.screenshot({
      path: `${output}/${palette}-${mode}-${highContrast ? 'contrast' : effects ? 'effects' : 'flat'}-dialog.png`,
    })
    await page.keyboard.press('Escape')
  }
  await page.emulateMedia({ forcedColors: 'active' })
  const systemDisabledColor = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'GrayText'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  const assertForcedDisabled = async (name) => {
    const disabled = page.getByRole('button', { name, exact: true })
    assert.equal(
      await disabled.evaluate((node) => getComputedStyle(node).color),
      systemDisabledColor,
    )
    assert.equal(
      await disabled.evaluate((node) => getComputedStyle(node).borderTopColor),
      systemDisabledColor,
    )
    assert.equal(await disabled.evaluate((node) => getComputedStyle(node).backgroundImage), 'none')
  }
  await assertForcedDisabled('Disabled')
  await page.getByRole('button', { name: 'Open control dialog' }).click()
  await assertForcedDisabled('Unavailable action')
  await page.screenshot({ path: `${output}/forced-colors-dialog.png` })
  await page.keyboard.press('Escape')
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
