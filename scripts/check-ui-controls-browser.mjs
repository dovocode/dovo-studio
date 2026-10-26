import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../apps/design-system/package.json', import.meta.url))
const axePath = require.resolve('axe-core', {
  paths: [dirname(require.resolve('@storybook/addon-a11y/package.json'))],
})
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
      import {createRoot} from 'react-dom/client';
      import {useState} from 'react';
      import {TaskSearchDialog} from '../extension-tasks/src/dialogs/task-search-dialog';
      import {studioThemes} from '../studio-core/src/themes';
      import {accessibleThemeColors} from '../studio-core/src/accessibility';
      window.studioThemes=studioThemes;window.accessibleThemeColors=accessibleThemeColors;
      import {Select, SelectTrigger, SelectValue, SelectContent, SelectItem} from './src/components/ui/select';
      import {Input} from './src/components/ui/input';
      import {Button} from './src/components/ui/button';
      import {ChoicePicker} from './src/choice-picker';
      import {PageHeader} from './src/page-header';
      import {SettingsGroup,Segmented} from './src/settings-layout';
      import {ChangeTypeFilters} from './src/review/change-types';
      import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from './src/components/ui/dialog';
      import {Dialog as WebDialog,DialogTrigger as WebTrigger,DialogContent as WebContent,DialogTitle as WebTitle,DialogDescription as WebDescription} from '../web-ui/src/dialog';
      function App(){const [value,setValue]=useState('theme-0'),[density,setDensity]=useState('comfortable'),[filter,setFilter]=useState(),[searchMode,setSearchMode]=useState(null);window.openedThreads??=[];return <main style={{padding:24}}>
        <button onClick={()=>setSearchMode('tasks')}>Search threads</button>
        <TaskSearchDialog mode={searchMode} onModeChange={setSearchMode} entries={[{key:'test-thread',projectName:'Studio',source:{name:'Mac Studio'},task:{id:'test-thread',title:'Repair connection',createdAt:'2026-10-23',messages:[]}}]} onSelect={entry=>window.openedThreads.push(entry.key)} onClose={()=>setSearchMode(null)}/>
        <PageHeader title="Artifacts" description="Saved work across computers"><Button>Refresh artifacts</Button><Button>Manage sharing</Button></PageHeader>
        <section id="read-only-header"><PageHeader title="Settings"><span>{'Saved computer settings · '.repeat(8)}</span><Button disabled>Save settings</Button></PageHeader></section>
        <Input aria-label="Path" className="font-mono text-xs md:text-xs" defaultValue="/work/project"/>
        <Button className="font-medium">Medium weight</Button>
        <section id="button-styles" aria-label="Button styles" className="flex flex-wrap gap-2">
          {['default','secondary','outline','ghost','destructive','link'].map(variant=><Button key={variant} variant={variant} onClick={()=>window.buttonActivations=(window.buttonActivations??0)+1}>{variant} action</Button>)}
          <Button disabled onClick={()=>window.disabledActivation=true}>Disabled action</Button>
          <Button disabled aria-busy="true">Pending action</Button>
          <Button asChild variant="outline"><a href="#button-styles">Styled link</a></Button>
        </section>
        <Select value={value} onValueChange={setValue}><SelectTrigger aria-label="Theme"><SelectValue/></SelectTrigger>
          <SelectContent>{Array.from({length:30},(_,i)=><SelectItem key={i} value={'theme-'+i}>Theme {i}</SelectItem>)}</SelectContent>
        </Select>
        <ChoicePicker aria-label="Computer" value="computer-49" onValueChange={value=>window.chosen=value}>{Array.from({length:50},(_,i)=><option key={i} value={'computer-'+i}>Computer {i}</option>)}</ChoicePicker>
        <Dialog><DialogTrigger>Long dialog</DialogTrigger><DialogContent><DialogTitle>Long content</DialogTitle><DialogDescription>Scroll test</DialogDescription>{Array.from({length:40},(_,i)=><p key={i}>Paragraph {i}</p>)}</DialogContent></Dialog>
        <WebDialog><WebTrigger>Hosted dialog</WebTrigger><WebContent><WebTitle>Hosted content</WebTitle><WebDescription>Scroll test</WebDescription>{Array.from({length:40},(_,i)=><p key={i}>Paragraph {i}</p>)}</WebContent></WebDialog>
        <Dialog><DialogTrigger>Editor dialog</DialogTrigger><DialogContent className="flex h-[400px] flex-col gap-0 overflow-hidden p-0"><DialogTitle>Editor</DialogTitle><DialogDescription>Fixed editor layout</DialogDescription><div className="min-h-0 flex-1 overflow-y-auto">{Array.from({length:40},(_,i)=><p key={i}>Line {i}</p>)}</div></DialogContent></Dialog>
        <Dialog><DialogTrigger>Custom close dialog</DialogTrigger><DialogContent className="gap-0 [&_[data-dialog-close]]:hidden"><DialogTitle>Custom editor</DialogTitle><DialogDescription>Editor owns its close button</DialogDescription><DialogTrigger>Finish editing</DialogTrigger></DialogContent></Dialog>
        <SettingsGroup title="Display"><Segmented label="Density" value={density} options={[['comfortable','Comfortable'],['compact','Compact']]} onChange={setDensity}/></SettingsGroup>
        <SettingsGroup title="Advanced display" advanced description="Optional display settings"><Input aria-label="Advanced option"/></SettingsGroup>
        <ChangeTypeFilters files={[{path:'src/app.ts',changeKind:'normal'},{path:'app.test.ts',changeKind:'tests'},{path:'mock.ts',changeKind:'mocks'},{path:'README.md',changeKind:'docs'},{path:'generated.ts',changeKind:'generated'}]} value={filter} onChange={setFilter}/>
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
  },
  [
    {
      path: '@dovo/studio-core',
      importer: root + 'packages/extension-tasks/src/dialogs',
      contents: 'export const useWorkspace=()=>({runtimeRegistry:{profiles:[]},connection:null});',
    },
    {
      path: '../list/use-task-search',
      importer: root + 'packages/extension-tasks/src/dialogs',
      contents: 'export const useTaskSearch=()=>({hits:[],loading:false,error:null});',
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [840, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 560 },
      hasTouch: width === 390,
      reducedMotion: 'reduce',
    })
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
    const primaryButton = page.getByRole('button', { name: 'default action', exact: true })
    await primaryButton.scrollIntoViewIfNeeded()
    const resting = await primaryButton.boundingBox()
    await primaryButton.focus()
    assert.equal(await primaryButton.evaluate((node) => node.matches(':focus-visible')), true)
    assert.equal(await primaryButton.evaluate((node) => getComputedStyle(node).outlineWidth), '2px')
    assert.notEqual(
      await primaryButton.evaluate((node) => getComputedStyle(node).boxShadow),
      'none',
    )
    assert.equal(
      await primaryButton.evaluate((node) => getComputedStyle(node).transitionProperty),
      'none',
    )
    await primaryButton.press('Enter')
    await primaryButton.press('Space')
    assert.equal(await page.evaluate(() => window.buttonActivations), 2)
    await page
      .getByRole('button', { name: 'Disabled action', exact: true })
      .evaluate((node) => node.click())
    assert.equal(await page.evaluate(() => window.disabledActivation), undefined)
    await primaryButton.hover()
    assert.deepEqual(
      await primaryButton.boundingBox(),
      resting,
      'Focus and hover do not resize buttons',
    )
    if (width === 390) assert.ok(resting.height >= 44, 'Buttons preserve touch target height')
    assert.equal(
      await page.getByRole('link', { name: 'Styled link' }).getAttribute('data-slot'),
      'button',
    )
    const heading = page.getByRole('heading', { name: 'Artifacts', exact: true })
    assert.equal(
      await heading.evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
      'Page actions must leave room for the page title',
    )
    await page.getByRole('button', { name: 'Manage sharing', exact: true }).focus()
    await page.keyboard.press('Tab')
    const readOnlyActions = page.locator('#read-only-header .studio-page-actions')
    assert.equal(
      await readOnlyActions.evaluate((element) => element === document.activeElement),
      true,
      'Keyboard users can reach overflowing labels and disabled header actions',
    )
    assert.equal(
      await readOnlyActions.evaluate((element) => getComputedStyle(element).outlineWidth),
      '2px',
    )
    assert.equal(
      await readOnlyActions.evaluate((element) => getComputedStyle(element).outlineOffset),
      '-2px',
    )
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(
      () => document.querySelector('#read-only-header .studio-page-actions').scrollLeft > 0,
    )
    await page.getByRole('radio', { name: 'Comfortable', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(
      await page.getByRole('radio', { name: 'Compact', exact: true }).getAttribute('aria-checked'),
      'true',
    )
    const advanced = page.locator('summary').filter({ hasText: 'Advanced display' })
    await advanced.click()
    await page.getByRole('textbox', { name: 'Advanced option' }).waitFor()
    await advanced.click()
    assert.equal(await page.getByRole('textbox', { name: 'Advanced option' }).isVisible(), false)
    const code = page.getByRole('button', { name: 'Code 1', exact: true })
    await code.click()
    assert.equal(await code.getAttribute('aria-pressed'), 'true')
    if (width === 390)
      assert.ok((await code.boundingBox()).height >= 44, 'Filters retain touch targets')
    await page.evaluate(() => (document.documentElement.dataset.highContrast = 'true'))
    assert.equal(
      await code.evaluate(
        (el) => getComputedStyle(el).borderTopColor === getComputedStyle(el).color,
      ),
      true,
      'High contrast selection keeps an outline',
    )
    await page.evaluate(() => delete document.documentElement.dataset.highContrast)
    await code.click()
    assert.equal(
      await page.getByRole('button', { name: 'All 5', exact: true }).getAttribute('aria-pressed'),
      'true',
    )
    if (width === 390) {
      await page.addScriptTag({ path: axePath })
      for (const palette of await page.evaluate(() => Object.keys(window.studioThemes))) {
        for (const highContrast of [false, true]) {
          for (const mode of ['light', 'dark']) {
            await page.evaluate(
              ({ mode, palette, highContrast }) => {
                const root = document.documentElement
                root.dataset.theme = mode
                root.dataset.highContrast = String(highContrast)
                root.classList.toggle('dark', mode === 'dark')
                const colors = window.accessibleThemeColors(
                  window.studioThemes[palette][mode],
                  mode,
                  highContrast,
                )
                for (const [name, value] of Object.entries(colors))
                  root.style.setProperty('--' + name, value)
                root.style.setProperty('--accent', colors.selection)
                root.style.setProperty('--muted', colors.card)
              },
              { mode, palette, highContrast },
            )
            const buttonViolations = await page.evaluate(async () =>
              (
                await window.axe.run('#button-styles', {
                  runOnly: { type: 'rule', values: ['color-contrast'] },
                })
              ).violations.map((item) => ({
                id: item.id,
                nodes: item.nodes.map((node) => node.failureSummary),
              })),
            )
            assert.deepEqual(
              buttonViolations,
              [],
              `${palette} ${mode}: buttons keep readable contrast`,
            )
            for (const name of ['All 5', 'Code 1', 'Tests 1', 'Mocks 1', 'Docs 1', 'Generated 1']) {
              await page.getByRole('button', { name, exact: true }).click()
              const violations = await page.evaluate(async () =>
                (
                  await window.axe.run('[aria-label="Change types"]', {
                    runOnly: { type: 'rule', values: ['color-contrast'] },
                  })
                ).violations.map((item) => ({
                  id: item.id,
                  nodes: item.nodes.map((node) => node.failureSummary),
                })),
              )
              assert.deepEqual(
                violations,
                [],
                `${palette} ${mode} highContrast=${highContrast} ${name}: category labels keep readable contrast`,
              )
            }
          }
        }
      }
      await page.evaluate(() => {
        document.documentElement.removeAttribute('style')
        delete document.documentElement.dataset.highContrast
      })
    }
    await page.getByRole('button', { name: 'Search threads', exact: true }).click()
    const threadSearch = page.getByRole('combobox', { name: 'Go to task', exact: true })
    await threadSearch.waitFor()
    const closeBox = await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .boundingBox()
    const hintBox = await page.getByText('Tab: messages', { exact: true }).boundingBox()
    const inputBox = await threadSearch.boundingBox()
    assert.ok(hintBox.x + hintBox.width <= closeBox.x, 'Search hint stays clear of close')
    assert.ok(inputBox.x + inputBox.width <= closeBox.x, 'Search input stays clear of close')
    for (const event of [
      { key: 'Enter', isComposing: true },
      { key: 'Enter', keyCode: 229 },
    ]) {
      await threadSearch.evaluate(
        (input, event) =>
          input.dispatchEvent(
            new KeyboardEvent('keydown', { ...event, bubbles: true, cancelable: true }),
          ),
        event,
      )
      assert.deepEqual(
        await page.evaluate(() => window.openedThreads),
        [],
        'IME confirmation must not open a thread',
      )
      assert.equal(await threadSearch.isVisible(), true)
    }
    await threadSearch.press('Enter')
    assert.deepEqual(
      await page.evaluate(() => window.openedThreads),
      ['test-thread'],
      'Normal Enter opens the result',
    )
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
    const selected = await page
      .getByRole('option', { name: 'Computer 49', exact: true })
      .boundingBox()
    const list = await page.getByRole('listbox').boundingBox()
    assert.ok(
      selected.y >= list.y && selected.y + selected.height <= list.y + list.height,
      `Selected computer must be visible when opening: ${JSON.stringify({ selected, list })}`,
    )
    await search.evaluate((input) => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    assert.equal(await page.evaluate(() => window.chosen), undefined, 'IME Enter must not select')
    assert.equal(await search.isVisible(), true)
    await search.evaluate((input) =>
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
    )
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.chosen), 'computer-49')
    await page.getByRole('button', { name: 'Computer', exact: true }).click()
    const anchoredSearch = await search.boundingBox()
    const anchoredList = await page.getByRole('listbox').boundingBox()
    const anchoredScroll = await page.evaluate(() => ({
      page: scrollY,
      dialog: document.querySelector('[role=dialog]').scrollTop,
    }))
    for (const query of ['Computer 2', 'Computer 49', 'no matching computer']) {
      await search.fill(query)
      if (query.startsWith('no ')) await page.getByText('No matching options.').waitFor()
      assert.deepEqual(
        await search.boundingBox(),
        anchoredSearch,
        'Filtering keeps the search anchored',
      )
      assert.deepEqual(
        await page.getByRole('listbox').boundingBox(),
        anchoredList,
        'Results reserve their viewport',
      )
    }
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    assert.equal(await search.inputValue(), '')
    assert.equal(await search.evaluate((node) => node === document.activeElement), true)
    for (const key of ['End', 'Home', 'ArrowUp', 'ArrowDown']) {
      await search.press(key)
      const active = page.locator(
        '[id="' + (await search.getAttribute('aria-activedescendant')) + '"]',
      )
      const row = await active.boundingBox(),
        viewport = await page.getByRole('listbox').boundingBox()
      assert.ok(
        row.y >= viewport.y - 1 && row.y + row.height <= viewport.y + viewport.height + 1,
        key + ' keeps the active option visible',
      )
      assert.deepEqual(await search.boundingBox(), anchoredSearch)
      assert.deepEqual(
        await page.evaluate(() => ({
          page: scrollY,
          dialog: document.querySelector('[role=dialog]').scrollTop,
        })),
        anchoredScroll,
        'Keyboard navigation scrolls only results',
      )
    }
    await page.keyboard.press('Escape')
    for (const name of ['Long dialog', 'Hosted dialog', 'Editor dialog']) {
      await page.getByRole('button', { name, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.evaluate((el) => (el.scrollTop = el.scrollHeight))
      const close = dialog.getByRole('button', { name: 'Close', exact: true })
      const bounds = await close.boundingBox()
      const panel = await dialog.boundingBox()
      assert.ok(
        bounds.y >= panel.y && bounds.y + bounds.height <= panel.y + panel.height,
        'Close stays inside the scrollable dialog',
      )
      assert.ok(
        bounds.x >= panel.x && bounds.x + bounds.width <= panel.x + panel.width,
        'Close stays within custom dialog widths and padding',
      )
      assert.ok(
        bounds.y >= 0 && bounds.y + bounds.height <= 560,
        `${name} close remains visible: ${JSON.stringify(bounds)}`,
      )
      await close.click()
      assert.equal(await dialog.count(), 0)
    }
    await page.getByRole('button', { name: 'Custom close dialog', exact: true }).click()
    assert.equal(
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).count(),
      0,
    )
    await page.keyboard.press('Escape')
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Shared controls: button focus, keyboard activation, touch targets, theme contrast, constrained select and searchable picker passed at 840px and 390px.',
  )
} finally {
  await browser.close()
}
