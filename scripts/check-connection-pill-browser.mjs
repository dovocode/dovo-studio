import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const mocks = {
  'react-native': `export const View=({children})=><div>{children}</div>;export const Alert={alert(){}};`,
  'expo-router': 'export const router={navigate(){}};',
  '@dovo/protocol': `export const runtimeSyncStatus=c=>c.status;export const runtimeReachability=e=>e.connected?'online':'offline';export const retryRuntimeSync=()=>{};export const runtimeComputerName=e=>e.profile.id;`,
  '../state/application-state': "export {useState as useApplicationState} from 'react';",
  './provider': `import {useEffect,useSyncExternalStore} from 'react';let state={id:'host',connected:true,status:'live',pending:0,error:null};const listeners=new Set();window.connectionState=next=>{state={...state,...next};listeners.forEach(fn=>fn())};export const useRuntime=()=>{const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);useEffect(()=>{window.renderedConnection=current.status+':'+current.id+':'+current.connected+':'+current.pending},[current]);return {ready:true,overviews:[{profile:{id:current.id,connection:{address:'http://host',status:current.status}},connected:current.connected}],mutationStatus:()=>({pending:current.pending,error:current.error}),refreshAll:async()=>{}}};`,
  '../../ui/content/text': 'export const Text=({children})=><span>{children}</span>;',
  '../../ui/controls/action':
    'export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;',
  '../../ui/controls/pill':
    'export const Pill=({label,onPress})=><button onClick={onPress}>{label}</button>;',
  '../../ui/layout/sheet': 'export const Sheet=({children})=><div>{children}</div>;',
  '../../ui/controls/use-action': 'export const useAction=()=>({busy:false,act:work=>work()});',
  '../../ui/content/format-date': 'export const formatDateTime=value=>value;',
  '../../ui/theme': 'export const useTheme=()=>({styles:{}});',
}
const bundle = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {ConnectionPill} from '${root}/apps/mobile/src/runtime/connection/connection-status.tsx';createRoot(document.getElementById('app')).render(<ConnectionPill/>);`,
    resolveDir: root + '/packages/studio-ui',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: { react: root + '/packages/studio-ui/node_modules/react' },
  nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
  plugins: [
    {
      name: 'native-boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 650 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const now = new Date()
  await page.clock.install({ time: now })
  await page.clock.pauseAt(now)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction(() => window.renderedConnection === 'live:host:true:0')
  const update = async (value) => {
    await page.evaluate((value) => window.connectionState(value), value)
    await page.waitForFunction(
      (value) => window.renderedConnection === value,
      value.status +
        ':' +
        (value.id ?? 'host') +
        ':' +
        (value.connected ?? true) +
        ':' +
        (value.pending ?? 0),
    )
  }
  const count = () => page.locator('#app button').count()
  await update({ status: 'reconnecting' })
  await page.clock.runFor(14_999)
  assert.equal(await count(), 0)
  await page.clock.runFor(1)
  await page.getByRole('button', { name: 'HTTP updates · Review', exact: true }).waitFor()
  await update({ status: 'live' })
  assert.equal(await count(), 0)
  // A short recovery restarts the full grace period; a cancelled timer cannot surface later.
  await update({ status: 'reconnecting' })
  await page.clock.runFor(10_000)
  await update({ status: 'live' })
  await page.clock.runFor(10_000)
  assert.equal(await count(), 0)
  await update({ status: 'reconnecting' })
  await page.clock.runFor(14_999)
  assert.equal(await count(), 0)
  await page.clock.runFor(1)
  await page.getByRole('button', { name: 'HTTP updates · Review', exact: true }).waitFor()
  // Switching affected computers starts a fresh delay.
  await update({ status: 'reconnecting', id: 'other' })
  assert.equal(await count(), 0)
  await page.clock.runFor(14_999)
  assert.equal(await count(), 0)
  await page.clock.runFor(1)
  await page.getByRole('button', { name: 'HTTP updates · Review', exact: true }).waitFor()
  await update({ status: 'reconnecting', id: 'host', connected: false })
  await page.clock.runFor(2499)
  assert.equal(await count(), 0)
  await page.clock.runFor(1)
  await page.getByRole('button', { name: 'Offline · Reconnect', exact: true }).waitFor()
  await update({ status: 'live', connected: true, pending: 1, error: 'Save failed' })
  await page.clock.runFor(2499)
  assert.equal(await count(), 0)
  await page.clock.runFor(1)
  await page.getByRole('button', { name: 'Saved actions · Review', exact: true }).waitFor()
  await update({ status: 'live', pending: 0, error: null })
  assert.equal(await count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Connection pill: 15-second HTTP grace period, recovery, host switching and existing offline/save delays passed',
  )
} finally {
  await browser.close()
}
