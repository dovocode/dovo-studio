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
      import {useState} from 'react';
      import {Segmented} from './src/settings-layout';
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
      function Density(){const [value,setValue]=useState('compact');return <Segmented label="Density" value={value} options={[["compact","Compact"],["comfortable","Comfortable"],["automatic","Automatic"]]} onChange={setValue}/>;}
      createRoot(document.getElementById('app')).render(<main className="p-6 space-y-4"><Card className="space-y-4"><Density/><div className="studio-menu-surface bg-transparent" data-test="menu-override">Custom surface</div><div className="flex flex-wrap gap-2"><Button>Save</Button><Button variant="ghost">Ghost</Button><Button size="icon" aria-label="Icon">+</Button><Button disabled>Disabled</Button></div><Input aria-label="Field"/><Input aria-label="Custom" className="bg-transparent"/><Input aria-label="Invalid" aria-invalid="true"/><Input aria-label="Rounded search" type="search" className="rounded-full" placeholder="Search"/><Input aria-label="Rounded URL" type="url" className="rounded-full" placeholder="http://localhost:3000"/><Textarea aria-label="Notes"/><Select defaultValue="one"><SelectTrigger aria-label="Choice"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem><SelectItem value="two">Two</SelectItem></SelectContent></Select><ChoicePicker aria-label="Computer" value="local" onValueChange={()=>{}}><option value="local">This computer</option></ChoicePicker><select aria-label="Native"><option>Native option</option></select><div className="flex gap-4"><Checkbox aria-label="Check" defaultChecked/><Switch aria-label="Switch" defaultChecked/></div><Dialog><DialogTrigger asChild><Button variant="outline">Open control dialog</Button></DialogTrigger><DialogContent><DialogTitle>Project settings</DialogTitle><DialogDescription>Shared controls in a production dialog.</DialogDescription><Input aria-label="Dialog name" defaultValue="Dovo Studio"/><Select defaultValue="one"><SelectTrigger aria-label="Dialog choice"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem></SelectContent></Select><div className="flex justify-end gap-2"><Button disabled>Unavailable action</Button><Button>Save project</Button></div></DialogContent></Dialog></Card><div className="studio-sidebar-brand-row"><header className="studio-titlebar" data-sidebar-brand="true" data-test="sidebar-brand">Sidebar</header></div><div className="studio-window-header-content"><header className="studio-browser-header" data-test="window-browser"><div className="studio-browser-toolbar">Browser</div></header></div><div className="studio-page-surface"><header className="studio-page-header">Page</header><header className="studio-task-thread-header">Thread</header><header className="studio-settings-toolbar">Settings</header><header className="studio-agent-profile-header">Agent</header><div className="studio-thread-tools-panel"><header className="studio-thread-tools-header">Tools</header></div></div><section data-test="navigation" className="studio flex"><div className="studio-task-sidebar"><div data-pane="threads" className="studio-overview-pane"><div className="studio-sidebar-controls">Search</div><div className="studio-sidebar-list">Rows</div><div className="studio-thread-row" data-highlighted><button data-row="thread" className="studio-thread-card">Thread</button></div></div></div><div className="studio-navigation-sidebar"><div data-pane="browser" className="studio-overview-pane studio-browser-sidebar"><div data-row="browser" className="studio-browser-tab" data-active><button className="studio-browser-tab-select">Browser</button></div><div data-row="idle" className="studio-browser-tab"><button className="studio-browser-tab-select">Idle tab</button></div><div data-row="pin" className="studio-browser-tab" data-pinned><button className="studio-browser-tab-select">Pin</button></div></div></div><div className="studio-task-sidebar"><div data-pane="unified" className="studio-overview-pane"><div data-row="unified" className="studio-browser-tab" data-active><button className="studio-browser-tab-select">Unified</button></div></div></div><div className="studio-task-sidebar"><div data-pane="terminal" className="studio-overview-pane">Terminal</div></div><nav className="studio-navigation-sidebar" aria-label="Settings sections"><div data-pane="settings" className="studio-overview-pane">Settings</div></nav><div className="studio-browser-address"><input aria-label="Browser address" defaultValue="http://localhost:3000"/></div></section></main>);
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
  const mount = async (page) => {
    await page.route('http://localhost/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div></body></html>',
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
  }
  await mount(page)
  const compact = page.getByRole('radio', { name: 'Compact', exact: true })
  await page.getByLabel('Notes').fill('Keep this draft')
  await compact.focus()
  const trackBounds = await page.getByRole('radiogroup', { name: 'Density' }).boundingBox()
  for (const [key, name] of [
    ['ArrowRight', 'Comfortable'],
    ['End', 'Automatic'],
    ['Home', 'Compact'],
  ]) {
    await page.keyboard.press(key)
    const radio = page.getByRole('radio', { name, exact: true })
    assert.equal(await radio.isChecked(), true)
    assert.equal(await radio.evaluate((node) => node === document.activeElement), true)
    assert.equal(await radio.evaluate((node) => getComputedStyle(node).outlineWidth), '2px')
    assert.deepEqual(
      await page.getByRole('radiogroup', { name: 'Density' }).boundingBox(),
      trackBounds,
      'Selection does not resize or move the track',
    )
  }
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
        root.dataset.highContrast = String(highContrast)
        root.dataset.motion = 'system'
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
    // Match production motion preferences, then measure the rendered endpoint
    // rather than an interpolated color while a palette transition finishes.
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((animation) => animation.playState !== 'running' && !animation.pending),
    )
    assert.equal(await page.getByLabel('Notes').inputValue(), 'Keep this draft')
    const selection = await compact.evaluate((node) => {
      const css = getComputedStyle(node)
      return { image: css.backgroundImage, shadow: css.boxShadow, outline: css.outlineWidth }
    })
    assert.equal(selection.image === 'none', !effects || highContrast)
    if (highContrast || !effects)
      assert.equal(selection.shadow, 'none', `${palette} ${mode}: flat selection shadow`)
    assert.equal(
      await compact.evaluate((node) => getComputedStyle(node).backdropFilter),
      'none',
      'Permanent controls use painted glass',
    )
    const style = (selector, property) =>
      page
        .locator(selector)
        .first()
        .evaluate((el, property) => getComputedStyle(el)[property], property)
    assert.equal(await style('[data-test="menu-override"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.equal(await style('[aria-label="Custom"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.notEqual(await style('[aria-label="Field"]', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
    assert.equal(
      await style('[aria-label="Notes"]', 'fontSize'),
      await style('[aria-label="Field"]', 'fontSize'),
      'Desktop single-line and multiline fields share their text size',
    )
    for (const selector of [
      '[aria-label="Field"]',
      '[aria-label="Choice"]',
      '[aria-label="Computer"]',
    ])
      assert.equal(await style(selector, 'borderRadius'), '10px', `${selector}: control radius`)
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
      assert.equal(
        unavailable.opacity,
        '0.5',
        `${name}: visibly unavailable, like secondary actions`,
      )
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
    assert.ok(
      highContrast ? fieldContrast >= 3 : fieldContrast >= 1.5 && fieldContrast < 3,
      `${palette} ${mode} highContrast=${highContrast}: field boundary contrast ${fieldContrast}`,
    )
    assert.equal(
      await style('[data-test="sidebar-brand"]', 'backgroundImage'),
      'none',
      'Sidebar brand stays flat above its glass pane',
    )
    assert.equal(
      await style('[data-test="window-browser"]', 'boxShadow'),
      'none',
      'The collapsed Browser header stays continuous with its window titlebar',
    )
    assert.equal(
      await style('[data-test="window-browser"]', 'backgroundImage'),
      await style('[data-test="navigation"]', 'backgroundImage'),
      'Browser header continues the page tint',
    )
    for (const property of ['backgroundColor', 'backgroundImage', 'boxShadow'])
      assert.equal(
        await style('[data-test="window-browser"] .studio-browser-toolbar', property),
        await style('[data-test="window-browser"]', property),
        `Browser toolbar shares its header's ${property}`,
      )
    const viewport = page.viewportSize()
    assert.equal(
      await style('[data-test="navigation"]', 'backgroundSize'),
      `${viewport.width}px ${viewport.height}px`,
    )
    for (const selector of [
      '.studio-page-surface',
      '.studio-page-header',
      '.studio-task-thread-header',
      '.studio-settings-toolbar',
      '.studio-agent-profile-header',
      '.studio-thread-tools-header',
    ])
      for (const property of [
        'backgroundImage',
        'backgroundSize',
        'backgroundPosition',
        'backgroundAttachment',
      ])
        assert.equal(
          await style(selector, property),
          await style('[data-test="navigation"]', property),
          `${selector} continues page ${property}`,
        )
    for (const selector of ['.studio-sidebar-controls']) {
      assert.equal(await style(selector, 'paddingTop'), '12px')
      assert.equal(await style(selector, 'paddingInline'), '12px')
      assert.equal(await style(selector, 'paddingBottom'), '8px')
    }
    assert.equal(await style('.studio-sidebar-list', 'paddingInline'), '6px')
    assert.equal(
      (await style('[data-test="navigation"]', 'backgroundImage')) === 'none',
      !effects || highContrast,
      'Background tint follows the effects preferences without a fixed-width cutoff',
    )
    for (const pane of ['browser', 'unified', 'terminal', 'settings'])
      for (const property of ['backgroundColor', 'backdropFilter', 'borderColor', 'borderRadius'])
        assert.equal(
          await style(`[data-pane="${pane}"]`, property),
          await style('[data-pane="threads"]', property),
          `${mode}: ${pane} and Threads share pane ${property}`,
        )
    for (const row of ['browser', 'unified'])
      for (const property of ['backgroundColor', 'backgroundImage', 'boxShadow', 'borderRadius'])
        assert.equal(
          await style(`[data-row="${row}"]`, property),
          await style('[data-row="thread"]', property),
          `${mode}: ${row} and Threads share selected ${property}`,
        )
    for (const row of ['idle', 'pin']) {
      assert.equal(await style(`[data-row="${row}"]`, 'borderColor'), 'rgba(0, 0, 0, 0)')
      assert.equal(await style(`[data-row="${row}"]`, 'backgroundColor'), 'rgba(0, 0, 0, 0)')
      assert.equal(await style(`[data-row="${row}"]`, 'backgroundImage'), 'none')
      assert.equal(await style(`[data-row="${row}"]`, 'boxShadow'), 'none')
    }
    assert.equal(await style('[data-row="pin"]', 'height'), '56px')
    assert.equal(await style('.studio-browser-address', 'backgroundImage'), 'none')
    assert.equal(await style('.studio-browser-address', 'backdropFilter'), 'none')
    const address = page.getByRole('textbox', { name: 'Browser address', exact: true })
    await address.scrollIntoViewIfNeeded()
    const addressBounds = await address.boundingBox()
    await address.focus()
    assert.equal(await address.evaluate((node) => node === document.activeElement), true)
    assert.notEqual(await style('.studio-browser-address', 'borderColor'), 'rgba(0, 0, 0, 0)')
    assert.deepEqual(await address.boundingBox(), addressBounds, 'Address focus preserves layout')
    await compact.focus()

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
        effects && (control !== 'Switch' || mode !== 'light'),
      )
    }
    const toggle = page.getByRole('switch', { name: 'Switch' })
    const checkedFill = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)
    await toggle.click()
    await toggle.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    )
    const offContrast = await toggle.evaluate((element, checkedFill) => {
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
      const css = getComputedStyle(element)
      const thumb = getComputedStyle(element.querySelector('[data-slot="switch-thumb"]'))
      const contrast = (first, second) =>
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
      const border = luminance(
        css.borderColor === 'rgba(0, 0, 0, 0)' ? css.backgroundColor : css.borderColor,
      )
      const surface = luminance(
        getComputedStyle(element.closest('[data-slot="card"]')).backgroundColor,
      )
      const track = luminance(css.backgroundColor)
      return {
        boundary: contrast(border, surface),
        thumb: Math.max(
          contrast(luminance(thumb.borderColor), track),
          contrast(luminance(thumb.backgroundColor), track),
        ),
        fill: css.backgroundColor,
        thumbLuminance: luminance(thumb.backgroundColor),
        checkedLuminance: luminance(checkedFill),
      }
    }, checkedFill)
    assert.ok(
      offContrast.boundary >= 3,
      `${palette} ${mode}: unchecked switch boundary contrast ${offContrast.boundary}`,
    )
    assert.ok(
      offContrast.thumb >= 3,
      `${palette} ${mode}: unchecked thumb contrast ${offContrast.thumb}`,
    )
    assert.notEqual(offContrast.fill, checkedFill, `${palette} ${mode}: distinct checked fill`)
    if (mode === 'light')
      assert.ok(
        offContrast.thumbLuminance >= 0.85 &&
          offContrast.thumbLuminance > offContrast.checkedLuminance,
        `${palette} ${mode}: light neutral thumb`,
      )
    await page.screenshot({
      path: `${output}/${palette}-${mode}-${highContrast ? 'contrast' : effects ? 'effects' : 'flat'}-switch-off.png`,
    })
    await toggle.focus()
    await page.keyboard.press('Space')
    await toggle.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    )
    assert.equal(await toggle.isChecked(), true)
    assert.ok(parseFloat(await toggle.evaluate((el) => getComputedStyle(el).outlineWidth)) >= 2)
    await page.getByRole('combobox', { name: 'Choice' }).click()
    assert.equal(
      (await style('[data-slot="select-content"]', 'backdropFilter')) !== 'none',
      !highContrast,
      'High contrast keeps popup surfaces opaque without blur',
    )
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
      assert.equal(await style(`[aria-label="${label}"]`, 'borderRadius'), '10px')
    await page.screenshot({
      path: `${output}/${palette}-${mode}-${highContrast ? 'contrast' : effects ? 'effects' : 'flat'}-dialog.png`,
    })
    await page.keyboard.press('Escape')
  }
  const media = await page.context().newCDPSession(page)
  for (const mode of ['light', 'dark']) {
    await page.evaluate((mode) => {
      document.documentElement.dataset.theme = mode
      document.documentElement.dataset.highContrast = 'false'
      document.documentElement.dataset.themeGradients = 'true'
    }, mode)
    await media.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    })
    await page.getByRole('button', { name: 'Open control dialog' }).click()
    const surface = await page.getByRole('dialog').evaluate((node) => {
      const style = getComputedStyle(node)
      return { filter: style.backdropFilter, image: style.backgroundImage }
    })
    assert.deepEqual(surface, { filter: 'none', image: 'none' }, `${mode}: reduced transparency`)
    await page.keyboard.press('Escape')
    for (const pane of ['threads', 'browser', 'unified', 'terminal', 'settings']) {
      assert.equal(
        await page
          .locator(`[data-pane="${pane}"]`)
          .evaluate((node) => getComputedStyle(node).backdropFilter),
        'none',
      )
    }
    assert.equal(await compact.evaluate((node) => getComputedStyle(node).backgroundImage), 'none')
    assert.equal(await compact.evaluate((node) => getComputedStyle(node).boxShadow), 'none')
  }
  await media.detach()
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
  await page.keyboard.press('Escape')
  for (const mode of ['light', 'dark']) {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: mode })
    await page.evaluate(
      (mode) => document.documentElement.classList.toggle('dark', mode === 'dark'),
      mode,
    )
    const toggle = page.getByRole('switch', { name: 'Switch' })
    for (const checked of [false, true]) {
      await toggle.focus()
      await page.keyboard.press('Space')
      await toggle.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
      )
      assert.equal(await toggle.isChecked(), checked)
      const colors = await toggle.evaluate((el) => {
        const root = getComputedStyle(el)
        const thumb = getComputedStyle(el.querySelector('[data-slot="switch-thumb"]'))
        const probe = document.createElement('span')
        probe.style.color = 'ButtonText'
        document.body.append(probe)
        const buttonText = getComputedStyle(probe).color
        probe.remove()
        return {
          trackBorder: root.borderColor,
          thumbBorder: thumb.borderColor,
          thumbFill: thumb.backgroundColor,
          buttonText,
          thumbBorderWidth: thumb.borderTopWidth,
          outline: root.outlineWidth,
        }
      })
      assert.equal(colors.trackBorder, colors.buttonText, `${mode}: forced track boundary`)
      assert.equal(colors.thumbBorder, colors.buttonText, `${mode}: forced thumb boundary`)
      assert.equal(colors.thumbBorderWidth, '1px')
      assert.notEqual(colors.thumbBorder, colors.thumbFill)
      assert.ok(parseFloat(colors.outline) >= 2, `${mode}: forced keyboard focus`)
      await page.screenshot({
        path: `${output}/forced-colors-${mode}-switch-${checked ? 'on' : 'off'}.png`,
      })
    }
  }
  const touch = await browser.newContext({
    viewport: { width: 320, height: 1100 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  })
  const phone = await touch.newPage()
  await mount(phone)
  for (const radio of await phone.getByRole('radio').all())
    assert.ok((await radio.boundingBox()).height >= 44, 'Touch options keep a 44px target')
  await phone.getByRole('radio', { name: 'Comfortable', exact: true }).tap()
  assert.equal(
    await phone.getByRole('radio', { name: 'Comfortable', exact: true }).isChecked(),
    true,
  )
  assert.equal(
    await phone
      .getByRole('radiogroup', { name: 'Density' })
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
    true,
    'Narrow controls wrap without horizontal overflow',
  )
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Touch fixture has no page overflow',
  )
  await phone.screenshot({ path: `${output}/touch-controls.png` })
  await touch.close()
  console.log('Shared controls appearance checks passed')
} finally {
  await browser.close()
}
