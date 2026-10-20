import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
    import {createRoot} from 'react-dom/client';
    import {useState} from 'react';
    import {ActivityBar} from './packages/studio-shell/src/activity-bar';
    import {UpdateSettings} from './packages/studio-shell/src/app-settings/updates';
    window.checks=0;window.downloads=0;
    let current={status:'idle'};
    const listeners=new Set();
    window.host={updates:{
      state:async()=>current,
      subscribe:(listener)=>{listeners.add(listener);return()=>listeners.delete(listener)},
      check:async()=>window.checks++,
      install:async()=>window.downloads++,
    }};
    function App(){
      const[state,setState]=useState(current);
      const[settings,setSettings]=useState(false);
      window.update=(value)=>{current=value;setState(value);listeners.forEach(listener=>listener(value))};
      window.showSettings=()=>setSettings(true);
      return settings?<UpdateSettings/>:<ActivityBar views={[{id:'settings',title:'Settings',icon:'runtime',navigationGroup:'settings'}]} activeId="" onSelect={()=>{}} update={state} onCheckUpdates={()=>window.checks++} onUpdate={()=>window.downloads++}/>;
    }
    createRoot(document.getElementById('app')).render(<App/>);
  `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: 'export const useStudioHost=()=>window.host;',
    },
    {
      path: './layout',
      importer: root + 'packages/studio-shell/src/app-settings/updates.tsx',
      contents: `
        export const SettingsGroup=({title,children})=><section><h2>{title}</h2>{children}</section>;
        export const SettingRow=({label,description,children})=><div>{label}{description}{children}</div>;
      `,
    },
    {
      path: './settings-select',
      importer: root + 'packages/studio-shell/src/app-settings/updates.tsx',
      contents: 'export const SettingsSelect=()=>null;',
    },
    {
      path: '@dovo/studio-ui',
      contents: `
  export * as Popover from '@radix-ui/react-popover';
  export const useNavigationSidebar=()=>null;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;
  export const MessageResponse=({children})=>children;
  export const Tooltip=({children})=>children;export const TooltipTrigger=({children})=>children;export const TooltipContent=()=>null;
  export const cn=(...values)=>values.filter(Boolean).join(' ');
`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const assets = root + 'apps/web/dist/client/assets/'
  const cssFile = (await readdir(assets)).find((name) => name.endsWith('.css'))
  const css = await readFile(assets + cssFile, 'utf8')
  await page.setContent(
    '<style>' + css + '</style><div id="app"></div><input aria-label="Message" />',
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const rail = page.getByRole('navigation', { name: 'Main navigation' })
  assert.equal(await rail.getByRole('button').count(), 2)
  const update = rail.locator('.studio-update-item')
  const settings = rail.getByRole('button', { name: 'Settings', exact: true })
  const buttonColor = (button) => button.evaluate((element) => getComputedStyle(element).color)
  assert.equal(await buttonColor(update), await buttonColor(settings))
  await page.evaluate(() => window.update({ status: 'error', error: 'Network unavailable' }))
  await page.waitForFunction(
    () => document.querySelector('.studio-update-item')?.dataset.updateAvailable === undefined,
  )
  assert.equal(await buttonColor(update), await buttonColor(settings))
  await page.evaluate(() => window.update({ status: 'idle' }))
  await update.click()
  await page.getByRole('button', { name: 'Check updates', exact: true }).click()
  assert.equal(await page.evaluate(() => window.checks), 1)
  await page.evaluate(() =>
    window.update({ status: 'available', version: '0.0.9', notes: 'New release' }),
  )
  assert.equal(await rail.getByRole('button').count(), 2)
  await page.waitForFunction(
    () => document.querySelector('.studio-update-item')?.dataset.updateAvailable === 'true',
  )
  assert.notEqual(await buttonColor(update), await buttonColor(settings))
  await page.getByRole('button', { name: 'Download update', exact: true }).click()
  assert.equal(await page.evaluate(() => window.downloads), 1)
  // Downloads started from Settings or the application menu also reveal progress.
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.classList.contains('studio-update-item'))
  await page.getByRole('textbox', { name: 'Message' }).focus()
  await page.evaluate(() =>
    window.update({
      status: 'downloading',
      version: '0.0.9',
      progress: 42,
      transferred: 4_404_019,
      total: 10_485_760,
      bytesPerSecond: 1_048_576,
    }),
  )
  await page.getByText('Downloading 42%', { exact: true }).waitFor()
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Message')
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '42')
  await page.getByText('4.2 MB / 10.0 MB', { exact: true }).waitFor()
  await page.getByText('1.0 MB/s', { exact: true }).waitFor()
  await page.getByText('You can keep working.', { exact: false }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Download update', exact: true }).count(), 0)
  // A progress tick must not reopen a panel the user dismissed.
  await page.keyboard.press('Escape')
  await page.evaluate(() =>
    window.update({ status: 'downloading', version: '0.0.9', progress: 43 }),
  )
  await page.waitForFunction(() =>
    document.querySelector('.studio-update-item')?.getAttribute('aria-label')?.includes('43%'),
  )
  assert.equal(await page.getByRole('progressbar').count(), 0)
  await page.evaluate(() => window.update({ status: 'downloaded', version: '0.0.9' }))
  await page.getByText('Ready to install.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Restart and install', exact: true }).click()
  assert.equal(await page.evaluate(() => window.downloads), 2)
  assert.equal(await rail.getByRole('button').count(), 2)
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.update({ status: 'restarting', version: '0.0.9' }))
  await page.getByText('Closing Dovo to install the update…', { exact: true }).waitFor()
  await page
    .getByText('Installation will continue after this window closes.', { exact: true })
    .waitFor()
  await page.evaluate(() => window.showSettings())
  await page.getByRole('heading', { name: 'Application updates' }).waitFor()
  await page.evaluate(() =>
    window.update({ status: 'downloading', version: '0.0.9', progress: 65 }),
  )
  await page.getByText('Downloading 65%', { exact: true }).waitFor()
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '65')
  assert.equal(await page.getByRole('button', { name: 'Downloading…' }).isDisabled(), true)
  await page.evaluate(() => window.update({ status: 'downloaded', version: '0.0.9' }))
  await page.getByRole('button', { name: 'Restart to update' }).click()
  assert.equal(await page.evaluate(() => window.downloads), 3)
  console.log('Update progress opens automatically, respects dismissal and explains installation.')
} finally {
  await browser.close()
}
