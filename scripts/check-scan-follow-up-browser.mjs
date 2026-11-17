import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const preferences = `
import {useSyncExternalStore} from 'react';
window.preferences??=JSON.parse(localStorage.getItem('scan-preferences')??'{"savedFilterViews":[],"shortcutOverrides":{},"sendWith":"enter"}');
const listeners=new Set();const notify=()=>listeners.forEach(fn=>fn());
export const readAppPreferences=()=>window.preferences;
export const updateAppPreferences=value=>{if(window.failSave)return false;window.preferences={...window.preferences,...value};localStorage.setItem('scan-preferences',JSON.stringify(window.preferences));notify();return true};
export const useAppPreferences=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},readAppPreferences);
export const useMobilePreferences=useAppPreferences;export const readMobilePreferences=readAppPreferences;
export const updateMobilePreferences=value=>{updateAppPreferences(value)};
export const retryMobilePreferences=async()=>{if(window.failSave)throw Error('Storage unavailable')};
export * from '${root}packages/studio-core/src/shortcuts.ts';
`
const native = `
export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',...style}}>{children}</div>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
export const Field=({label,value,onChangeText,maxLength})=><label>{label}<input maxLength={maxLength} aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/></label>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const useTheme=()=>({styles:{}});
`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const mocks = {
      '@dovo/studio-core': preferences,
      '../runtime/preferences/app-preferences': preferences,
      '@dovo/studio-ui': `export {Button} from '${root}packages/studio-ui/src/components/ui/button';export {Input} from '${root}packages/studio-ui/src/components/ui/input';export {SettingsPage,SettingsGroup} from '${root}packages/studio-ui/src/settings-layout';`,
      '@dovo/studio-core/interface-language': `export const useInterfaceText=()=>text=>text;`,
      'react-native': native,
      '../ui/controls/action': native,
      '../ui/controls/choice': native,
      '../ui/controls/field': native,
      '../ui/content/text': native,
      '../ui/theme': native,
    }
    const built = await build({
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {SavedFilterViews} from '${root}${mobile ? 'apps/mobile/src/scm' : 'packages/extension-scm/src'}/saved-filter-views';
import Shortcuts from '${root}packages/studio-shell/src/app-settings/shortcuts';
const initial={source:'repo-a',search:'bug',state:'open',sort:'updated',jiraFilters:{labels:['triage']},layout:'list'};
function App(){const[value,setValue]=useState(initial),[scope,setScope]=useState('account-a'),[sources,setSources]=useState([{key:'repo-a',identity:'account-a/repo-a'}]),[mode,setMode]=useState('views'),[revision,setRevision]=useState(0);window.changeFilters=()=>setValue({...initial,search:'new search'});window.addProject=()=>setSources(v=>[...v,{key:'repo-b',identity:'b'}]);window.changeAccount=()=>{setScope('account-b');setSources([{key:'repo-a',identity:'account-b/repo-a'}])};window.restoreAccount=()=>{setScope('account-a');setSources([{key:'repo-a',identity:'account-a/repo-a'}])};window.remount=()=>setRevision(v=>v+1);window.openShortcuts=()=>setMode('shortcuts');return <main className="p-4"><h1>Scan controls</h1>{mode==='shortcuts'?<Shortcuts/>:<><SavedFilterViews key={revision} kind="issues" scope={scope} sources={sources} value={value} onApply={next=>{window.applied=next;setValue(next)}}/><output aria-label="Current search">{value.search}</output></>}</main>};createRoot(document.getElementById('app')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      alias: {
        react: root + 'packages/studio-ui/node_modules/react',
        'react-dom/client': root + 'packages/studio-ui/node_modules/react-dom/client.js',
        '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      },
      nodePaths: [root + 'packages/studio-ui/node_modules', root + 'node_modules'],
      plugins: [
        {
          name: 'boundaries',
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
            )
            b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: root + 'packages/studio-ui',
            }))
          },
        },
      ],
    })
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1100, height: 900 } })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://scan.local/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html class="dark"><body><div id="app"></div></body></html>',
      }),
    )
    await page.goto('http://scan.local/')
    for (const file of (await readdir(root + 'apps/desktop/dist/assets')).filter((file) =>
      file.endsWith('.css'),
    ))
      await page.addStyleTag({
        content: await readFile(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
      })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const expand = async () =>
      mobile
        ? page.getByRole('button', { name: 'Saved views', exact: true }).click()
        : page.locator('summary').click()
    await expand()
    await page.getByRole('textbox', { name: 'View name', exact: true }).fill('Triage')
    await page.getByRole('button', { name: 'Save new view', exact: true }).click()
    await page.waitForFunction(() => window.preferences.savedFilterViews.length === 1)
    const id = await page.evaluate(() => window.preferences.savedFilterViews[0].id)
    await page.evaluate(() => window.changeFilters())
    await page.getByRole('button', { name: 'Update filters', exact: true }).click()
    await page.waitForFunction(
      () => window.preferences.savedFilterViews[0].filters.search === 'new search',
    )
    await page.getByRole('textbox', { name: 'View name', exact: true }).fill('My triage')
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.waitForFunction(() => window.preferences.savedFilterViews[0].name === 'My triage')
    await page.evaluate(() => window.remount())
    await expand()
    await page.getByRole('combobox', { name: 'Saved view', exact: true }).selectOption(id)
    await page.waitForFunction(() => window.applied?.search === 'new search')
    await page.evaluate(() => window.addProject())
    assert.equal(
      await page.getByRole('combobox', { name: 'Saved view', exact: true }).inputValue(),
      id,
    )
    await page.evaluate(() => window.changeAccount())
    await page.waitForFunction(() => document.querySelector('select').options.length === 1)
    assert.equal(await page.getByRole('button', { name: 'Delete view', exact: true }).count(), 0)
    await page.evaluate(() => window.restoreAccount())
    await page.getByRole('combobox', { name: 'Saved view', exact: true }).selectOption(id)
    await page.evaluate(() => (window.failSave = true))
    await page.getByRole('textbox', { name: 'View name', exact: true }).fill('Cannot save')
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(
      await page.evaluate(() => window.preferences.savedFilterViews[0].name),
      'My triage',
    )
    await page.evaluate(() => (window.failSave = false))
    await mkdir(root + 'output/scan-follow-up', { recursive: true })
    await page.screenshot({
      path: root + `output/scan-follow-up/${mobile ? 'mobile' : 'desktop'}-saved-views.png`,
    })
    await page.getByRole('button', { name: 'Delete view', exact: true }).click()
    await page.waitForFunction(() => window.preferences.savedFilterViews.length === 0)
    if (!mobile) {
      await page.evaluate(() => window.openShortcuts())
      const field = page.getByRole('textbox', { name: 'Open the command palette', exact: true })
      await field.press('Control+Shift+j')
      await page.waitForFunction(
        () => window.preferences.shortcutOverrides.palette === 'Mod+Shift+j',
      )
      await field.press('Control+n')
      await page.getByRole('alert').filter({ hasText: 'Already used for' }).waitFor()
      assert.equal(await field.inputValue(), 'Ctrl+Shift+j')
      const row = field.locator('..')
      await row.getByRole('button', { name: 'Unassign', exact: true }).click()
      assert.equal(await field.inputValue(), 'Unassigned')
      await row.getByRole('button', { name: 'Reset', exact: true }).click()
      assert.equal(await field.inputValue(), 'Ctrl+k')
      await field.focus()
      await page.keyboard.press('Tab')
      assert.equal(
        await row
          .getByRole('button', { name: 'Unassign', exact: true })
          .evaluate((el) => document.activeElement === el),
        true,
      )
      await page.screenshot({ path: root + 'output/scan-follow-up/shortcuts.png' })
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Saved views passed create, update, rename, delete, remount, project addition, account isolation and storage failure checks on desktop and mobile adapters. Shortcut controls passed remap, conflict, unassign, reset and Tab checks.',
  )
} finally {
  await browser.close()
}
