import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const mocks = {
  'react-native': `export const View=({children})=><div>{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const ActivityIndicator=()=>null;export const Alert={alert(_title,_message,choices){window.confirmChoice=name=>choices.find(choice=>choice.text===name)?.onPress?.()}};`,
  'expo-router': 'export const router={navigate(){}};',
  '@dovo/protocol': `export const connectionProgress=e=>[{label:e.connected?'Ready':'Connect',state:e.connected?'done':'failed'}];export const runtimeSyncStatus=c=>c.status;export const runtimeReachability=e=>e.connected?'online':'offline';export const retryRuntimeSync=()=>{};export const runtimeComputerName=e=>e.profile.id;export const attachmentUploadSchema={};export const decodeResult=(_schema,input)=>({success:!!input?.name,data:input});`,
  '../state/application-state': "export {useState as useApplicationState} from 'react';",
  './connection-type': 'export const useConnectionTypes=()=>()=>({label:"Private · LAN / VPN"});',
  './account-context': 'export const useOptionalMobileAccount=()=>null;',
  './provider': `import {useEffect,useSyncExternalStore} from 'react';let state={id:'host',connected:true,status:'live',pending:0,error:null,uploads:[]};window.actions=[];const listeners=new Set();window.connectionState=next=>{state={...state,...next};listeners.forEach(fn=>fn())};export const useRuntime=()=>{const current=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);useEffect(()=>{window.renderedConnection=current.status+':'+current.id+':'+current.connected+':'+current.pending},[current]);return {ready:true,overviews:[{profile:{id:current.id,connection:{address:'http://host',status:current.status}},snapshot:current.snapshot,connected:current.connected}],mutationStatus:()=>({pending:current.pending,error:current.error}),attachmentUploads:()=>current.uploads,recoverAttachment:async(_p,id)=>window.actions.push(['attach',id]),discardAttachment:async(_p,id)=>window.actions.push(['discard',id]),refreshAll:async()=>{}}};`,
  '../../ui/content/text': 'export const Text=({children})=><span>{children}</span>;',
  '../../ui/controls/action':
    'export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;',
  '@dovo/design': 'export const designTokens={touchTarget:44};',
  '../content/text': 'export const Text=({children})=><span>{children}</span>;',
  './icon': 'export const Icon=()=>null;',
  './icon-button':
    'export const IconButton=({label,onPress})=><button aria-label={label} onClick={onPress}>Dismiss</button>;',
  '../theme': 'export const useTheme=()=>({colors:{text:"#222",surface:"#fff",border:"#ccc"}});',
  '../../ui/layout/sheet': 'export const Sheet=({children})=><div>{children}</div>;',
  '../../ui/controls/use-action': 'export const useAction=()=>({busy:false,act:work=>work()});',
  '../../ui/content/format-date': 'export const formatDateTime=value=>value;',
  '../../ui/theme': `export const useTheme=()=>({styles:{},colors:{text:"#222",muted:"#666",error:"#b00020"}});`,
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
  await page.getByRole('button', { name: 'Dismiss HTTP updates · Review', exact: true }).click()
  assert.equal(await count(), 0)
  await page.clock.runFor(60_000)
  assert.equal(await count(), 0, 'A dismissed notice stays hidden while its condition persists')
  // Switching affected computers starts a fresh delay.
  await update({ status: 'reconnecting', id: 'other' })
  assert.equal(await count(), 0)
  await page.clock.runFor(14_999)
  assert.equal(await count(), 0)
  await page.clock.runFor(1)
  await page.getByRole('button', { name: 'HTTP updates · Review', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Dismiss HTTP updates · Review', exact: true }).click()
  await update({ status: 'live', id: 'other' })
  await update({ status: 'reconnecting', id: 'other' })
  await page.clock.runFor(15_000)
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
  await update({
    status: 'live',
    pending: 1,
    error: 'Saved attachments need review.',
    snapshot: { workspace: { tasks: [{ id: 'task', title: 'Release notes' }] } },
    uploads: [
      { id: 'upload', input: { name: 'photo.png', taskId: 'task', queuedMessageId: 'message' } },
    ],
  })
  await page.getByRole('button', { name: 'Saved actions · Review', exact: true }).click()
  await page.getByText('photo.png · Release notes · queued edit').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Retry saved actions' }).count(), 0)
  await page.getByRole('button', { name: 'Attach to current task draft' }).click()
  assert.deepEqual(await page.evaluate(() => window.actions), [])
  await page.evaluate(() => window.confirmChoice('Attach'))
  await page.getByRole('button', { name: 'Discard saved upload' }).click()
  await page.evaluate(() => window.confirmChoice('Discard'))
  assert.deepEqual(await page.evaluate(() => window.actions), [
    ['attach', 'upload'],
    ['discard', 'upload'],
  ])
  await update({
    status: 'live',
    pending: 2,
    error: 'Saved attachments need review.',
    snapshot: null,
    uploads: [
      { id: 'private-upload-id', input: { name: 'report.txt', taskId: 'private-task-id' } },
      { id: 'another-private-id', input: null },
    ],
  })
  await page.getByText('report.txt', { exact: true }).waitFor()
  await page.getByText('Saved attachment', { exact: true }).waitFor()
  assert.equal(await page.getByText(/private-(upload|task)-id|another-private-id/).count(), 0)
  await update({ status: 'live', pending: 0, error: null })
  assert.equal(await count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Connection pill: dismiss control, persistent dismissal, recovery, host switching and existing offline/save delays passed',
  )
} finally {
  await browser.close()
}
