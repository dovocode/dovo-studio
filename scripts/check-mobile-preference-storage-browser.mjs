import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';
import {PreferenceStorageNotice} from './apps/mobile/src/runtime/preferences/storage-notice.tsx';
import {preferencesReady,updateMobilePreferences,readMobilePreferenceStorage} from './apps/mobile/src/runtime/preferences/app-preferences.ts';
window.savedPreferences=[];
window.failSave=true;
window.ready=preferencesReady;
window.editPreference=()=>updateMobilePreferences({keepScreenOn:true});
window.storageStatus=readMobilePreferenceStorage;
createRoot(document.getElementById('app')).render(<PreferenceStorageNotice/>);`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    conditions: ['development'],
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    alias: { react: root + 'packages/studio-ui/node_modules/react' },
  },
  [
    { path: 'react-native', contents: 'export const View=({children})=><div>{children}</div>;' },
    {
      importer: root + 'apps/mobile/src/runtime/preferences/',
      path: '../../ui/content/text',
      contents:
        'export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;',
    },
    {
      importer: root + 'apps/mobile/src/runtime/preferences/',
      path: '../../ui/theme',
      contents: 'export const useTheme=()=>({styles:{}});',
    },
    {
      importer: root + 'apps/mobile/src/runtime/preferences/',
      path: '../../ui/controls/action',
      contents:
        'export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
    },
    {
      importer: root + 'apps/mobile/src/runtime/preferences/',
      path: '../../ui/controls/use-action',
      contents: `import {useState} from 'react';export const useAction=()=>{const [busy,setBusy]=useState(false);return {busy,act:async work=>{setBusy(true);try{await work()}catch{}finally{setBusy(false)}}}};`,
    },
    {
      path: '@react-native-async-storage/async-storage',
      contents: `export default {getItem:async()=>JSON.stringify({taskSort:'title'}),setItem:async(key,value)=>{if(window.failSave)throw Error('Disk full');window.savedPreferences.push(JSON.parse(value))}};`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 650 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate(() => window.ready)
  assert.equal(await page.getByRole('alert').count(), 0)
  await page.evaluate(() => window.editPreference())
  await page.getByRole('alert').filter({ hasText: 'Could not save preferences' }).waitFor()
  const retry = page.getByRole('button', { name: 'Retry saving preferences', exact: true })
  await retry.click()
  await page.waitForFunction(() => window.storageStatus().error !== null)
  assert.deepEqual(await page.evaluate(() => window.savedPreferences), [])
  await page.evaluate(() => {
    window.failSave = false
  })
  await retry.click()
  await page.waitForFunction(() => window.storageStatus().error === null)
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.equal(await retry.count(), 0)
  assert.deepEqual(
    await page.evaluate(() =>
      window.savedPreferences.map(({ taskSort, keepScreenOn }) => ({ taskSort, keepScreenOn })),
    ),
    [{ taskSort: 'title', keepScreenOn: true }],
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile preferences: visible failed save, failed retry, latest settings preserved and successful retry clears notice.',
  )
} finally {
  await browser.close()
}
