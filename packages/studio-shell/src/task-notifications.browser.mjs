import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from '../../../scripts/browser/harness.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'packages/studio-shell/src',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {useTaskNotifications} from './task-notifications';
import {TaskNotificationNotice} from './task-notice';
window.runtimes=[];window.listeners=new Set();window.opens=[];
window.preferences={inAppNotifications:true,inputPreview:true,notifyInput:true,notifyDone:true,notifyAutomations:true,notifySound:false};
window.osNotifications=[];
window.Notification=class {
 static permission='granted';
 constructor(title,options){this.title=title;this.options=options;window.osNotifications.push(this)}
 close(){}
};
window.updateRuntimes=value=>{window.runtimes=value;for(const listener of window.listeners)listener()};
// Keep expiry deterministic without waiting eight seconds for each queued notice.
const nativeSetTimeout=window.setTimeout;
window.setTimeout=(callback,delay,...args)=>delay===8000?(window.expireNotice=callback,123456789):nativeSetTimeout(callback,delay,...args);
window.previewSyncs=[];
const preview={sync:async value=>window.previewSyncs.push(value),onOpenThread:()=>()=>{}};
const open=target=>window.opens.push(target);
function App(){
 const [active,setActive]=useState(undefined);
 window.setActive=setActive;
 const notices=useTaskNotifications(open,preview,active);
 return <TaskNotificationNotice notice={notices.notice} pendingCount={notices.pendingCount} onOpen={open} onDismiss={notices.dismiss}/>;
}
createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `
import {useSyncExternalStore} from 'react';
export const readAppPreferences=()=>window.preferences;
export const useAppPreferences=()=>window.preferences;
export const useWorkspace=()=>({runtimes:useSyncExternalStore(listener=>{window.listeners.add(listener);return()=>window.listeners.delete(listener)},()=>window.runtimes)});
`,
    },
  ],
)

const task = (id) => ({ id, title: `Task ${id}`, status: 'running' })
const runtime = {
  profile: {
    id: 'runtime',
    name: 'Computer',
    connection: { address: 'http://server.lan:8787', token: 'fixture' },
  },
  connected: true,
  snapshot: {
    workspace: { tasks: [task('one'), task('two'), task('three')], automations: [] },
    approvals: [],
    questions: [],
    runs: [],
  },
}
const approval = (id, taskId) => ({ id, taskId, title: 'Review', detail: '', createdAt: '' })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 980, height: 700 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.bringToFront()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.listeners?.size > 0)
  await page.evaluate((entry) => window.updateRuntimes([entry]), runtime)
  await page.waitForFunction(() => window.previewSyncs.length >= 2)
  assert.equal(await page.evaluate(() => document.hasFocus()), true)
  runtime.snapshot.approvals = [approval('first', 'one'), approval('second', 'two')]
  await page.evaluate((entry) => window.updateRuntimes([entry]), runtime)
  await page.getByRole('button', { name: 'Open Task one · Needs input' }).waitFor()
  assert.equal(await page.getByRole('status').count(), 1)
  await page.getByText('1 more notifications', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.firstExpiry = window.expireNotice
  })
  // A later arrival must not replace the current notice.
  runtime.snapshot.approvals.push(approval('third', 'three'))
  await page.evaluate((entry) => window.updateRuntimes([entry]), runtime)
  await page.getByRole('button', { name: 'Open Task one · Needs input' }).waitFor()
  await page.getByText('2 more notifications', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.firstExpiry === window.expireNotice),
    true,
    'New arrivals keep the visible notice expiry',
  )
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.opens[0].entityId), 'one')
  await page.getByRole('button', { name: 'Open Task two · Needs input' }).waitFor()
  await page.getByRole('button', { name: 'Dismiss notification' }).click()
  await page.getByRole('button', { name: 'Open Task three · Needs input', exact: true }).waitFor()
  await page.evaluate(() => window.expireNotice())
  await page.waitForFunction(() => !document.querySelector('[role="status"]'))
  // An additional request for an already-waiting thread still gets its own notice.
  runtime.snapshot.approvals.push(approval('fourth', 'one'))
  await page.evaluate((entry) => window.updateRuntimes([entry]), runtime)
  await page.getByRole('button', { name: 'Open Task one · Needs input', exact: true }).waitFor()
  await page.evaluate(() =>
    window.setActive({ runtimeId: 'runtime', viewId: 'tasks', entityId: 'one' }),
  )
  await page.waitForFunction(() => !document.querySelector('[role="status"]'))
  runtime.snapshot.approvals.push(approval('fifth', 'one'))
  await page.evaluate((entry) => window.updateRuntimes([entry]), runtime)
  // Preview still receives every request, including the active thread's suppressed notice.
  await page.waitForFunction(() => window.previewSyncs.at(-1)?.items.length === 5)
  assert.equal(await page.getByRole('status').count(), 0)
  await page.evaluate((entry) => window.updateRuntimes([{ ...entry, connected: false }]), runtime)
  runtime.snapshot.approvals.push(approval('offline', 'two'))
  await page.evaluate((entry) => window.updateRuntimes([entry]), runtime)
  await page.waitForFunction(() => window.previewSyncs.at(-1)?.items.length === 6)
  assert.equal(
    await page.getByRole('status').count(),
    0,
    'Reconnect must not replay waiting requests',
  )
  await page.evaluate(() => {
    document.hasFocus = () => false
  })
  runtime.snapshot.approvals.push(
    approval('background-one', 'two'),
    approval('background-two', 'two'),
  )
  await page.evaluate((entry) => window.updateRuntimes([entry]), runtime)
  await page.waitForFunction(() => window.osNotifications.length === 2)
  assert.equal(
    await page.evaluate(
      () => new Set(window.osNotifications.map((notice) => notice.options.tag)).size,
    ),
    2,
  )
  assert.equal(
    await page.evaluate(() =>
      window.osNotifications.every(
        (notice) => notice.title === 'Needs your input' && notice.options.silent,
      ),
    ),
    true,
  )
  assert.equal(await page.getByRole('status').count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Task notification browser checks passed: queued arrivals, keyboard open, dismiss, expiry, request identity, active suppression, reconnect gating, preview sync, background notifications.',
  )
} finally {
  await browser.close()
}
