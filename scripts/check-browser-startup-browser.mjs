import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {StrictMode,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserStartup} from './packages/extension-tasks/src/browser/browser-startup';
import {decode,browserCommandSchema} from '@dovo/protocol';
window.calls=[];window.enabled=true;const listeners=new Set();window.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
window.publish=()=>listeners.forEach(fn=>fn());
const browser=async command=>{decode(browserCommandSchema,command);window.calls.push(command);if(command.url.includes('/failure'))throw Error('Page failed');};
function App(){useSyncExternalStore(window.subscribe,()=>window.enabled);return <><BrowserStartup browser={browser}/><main>Threads overview</main></>}
window.start=()=>createRoot(document.getElementById('app')).render(<StrictMode><App/></StrictMode>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    nodePaths: [root + 'apps/desktop/node_modules'],
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents:
        'export const useAppPreferences=()=>({browserWorkspaceEnabled:window.enabled,unifiedWorkspaceEnabled:false});',
    },
  ],
)
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  await context.route('http://studio.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  const errors = []
  async function open(tabs, enabled = true) {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('http://studio.test/')
    if (tabs)
      await page.evaluate(
        (tabs) =>
          localStorage.setItem(
            'dovo.shared-browser-tabs.v1',
            JSON.stringify({ tabs, active: tabs[0].id }),
          ),
        tabs,
      )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.evaluate((enabled) => {
      window.enabled = enabled
      window.start()
    }, enabled)
    await page.getByRole('main').waitFor()
    return page
  }
  const base = { kind: 'web', profileId: 'work', title: 'Saved app', url: 'http://lan.test/app' }
  const tabs = [
    { ...base, id: 'awake', keepAwake: true },
    { ...base, id: 'default', url: 'https://mail.google.com/mail/u/0/' },
    { ...base, id: 'moved', nativeKey: 'original-native-key', keepAwake: true },
    { ...base, id: 'ordinary' },
    { ...base, id: 'optout', url: 'https://teams.microsoft.com/', keepAwake: false },
    {
      ...base,
      id: 'private',
      profileId: 'private-00000000-0000-4000-8000-000000000001',
      keepAwake: true,
    },
    { ...base, id: 'remote', kind: 'remote', runtimeId: 'other-computer', keepAwake: true },
    { ...base, id: 'snoozed', snoozedUntil: Date.now() + 3600000, keepAwake: true },
    { ...base, id: 'settled', settledAt: Date.now(), keepAwake: true },
    { ...base, id: 'detached', detached: 'other-window-key', keepAwake: true },
    { ...base, id: 'blank', url: '', keepAwake: true },
  ]
  let page = await open(tabs)
  await page.waitForFunction(() => window.calls.length === 3)
  assert.deepEqual(await page.evaluate(() => window.calls.map((c) => c.key)), [
    'studio:browser:main:awake',
    'studio:browser:main:default',
    'original-native-key',
  ])
  assert.equal(await page.evaluate(() => window.calls[0].profileId), 'work')
  assert.equal(
    await page.evaluate(() => window.calls.every((c) => c.action === 'keep-awake')),
    true,
  )
  assert.equal(await page.getByRole('main').innerText(), 'Threads overview')
  const saved = await page.evaluate(() => localStorage.getItem('dovo.shared-browser-tabs.v1'))
  await page.close()
  // New renderer: no in-memory tab cache, same persisted storage.
  page = await open()
  await page.waitForFunction(() => window.calls.length === 3)
  assert.equal(
    await page.evaluate(() => localStorage.getItem('dovo.shared-browser-tabs.v1')),
    saved,
  )
  await page.close()
  page = await open(undefined, false)
  assert.equal(await page.evaluate(() => window.calls.length), 0)
  await page.evaluate(() => {
    window.enabled = true
    window.publish()
  })
  await page.waitForFunction(() => window.calls.length === 3)
  await page.evaluate(() => {
    window.enabled = false
    window.publish()
  })
  await page.getByRole('main').waitFor()
  await page.evaluate(() => {
    window.enabled = true
    window.publish()
  })
  await page.getByRole('main').waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.length),
    3,
    'Preference renders do not reload live pages',
  )
  await page.close()
  page = await open([
    { ...base, id: 'fail', url: 'http://lan.test/failure', keepAwake: true },
    { ...base, id: 'good', keepAwake: true },
  ])
  await page.getByRole('alert').waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.length),
    2,
    'A failed page does not block another tab',
  )
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  // The startup service must stay outside the lazy Workbench view and out of pop-out windows.
  const entry = readFileSync(root + 'apps/desktop/src/main.tsx', 'utf8')
  assert.match(entry, /!threadWindow && !browserWindowId && <BrowserStartup/)
  console.log(
    'Browser startup: saved awake pages restore in Threads, cold renderer restart, StrictMode single launch, defaults/opt-outs, profile/native identity, disabled workspace and failed-page isolation pass. Native bridge is scripted.',
  )
  await context.close()
} finally {
  await browser.close()
}
