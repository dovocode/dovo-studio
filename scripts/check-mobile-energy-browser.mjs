import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mocks = {
  'react-native': `import React from 'react';const listeners=new Set();export const AppState={currentState:'active',addEventListener:(_,listener)=>{listeners.add(listener);return {remove:()=>listeners.delete(listener)}}};window.setAppState=state=>{AppState.currentState=state;for(const listener of listeners)listener(state)};export const Platform={OS:'ios'};export const View=({children})=><div>{children}</div>;`,
  expo: `export const requireOptionalNativeModule=()=>({});`,
  '../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../runtime/state/application-state': `import {useState,useRef} from 'react';export const useApplicationState=initial=>{const [value,setValue]=useState(initial);const ref=useRef(value);ref.current=value;return [value,setValue,ref]};`,
  '../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../ui/theme': `export const styles={};`,
  './tasks-widget': `export default {updateSnapshot:props=>window.writes.push(structuredClone(props))};`,
  'react-native-webview': `import {forwardRef,useImperativeHandle,useEffect} from 'react';export const WebView=forwardRef((props,ref)=>{useImperativeHandle(ref,()=>({injectJavaScript:code=>window.commands.push(code)}));useEffect(()=>props.onMessage({nativeEvent:{data:JSON.stringify({type:'ready'})}}),[]);return null});`,
  '@react-native-async-storage/async-storage': `export default {getItem:async()=>"true",setItem:async()=>{}};`,
  './controller': `import {Effect} from 'effect';export const createActivityController=()=>Effect.sync(()=>{window.controllers++;return {sync:()=>Effect.sync(()=>window.activitySyncs++),dispose:async()=>{window.activityDisposals++}}});`,
  '@dovo/client-runtime': `import {startPolling as poll} from '${root}/packages/client-runtime/src/index.ts';export {clientTaskScope,runClientEffect} from '${root}/packages/client-runtime/src/index.ts';export const startPolling=(work,options)=>{window.pollers++;const worker=poll(work,options);return {refresh:worker.refresh,stop:async()=>{window.pollStops++;await worker.stop()}}};export const startReconnecting=(run,onError)=>{const controller=new AbortController();window.starts++;void run(controller.signal,()=>{}).catch(onError);return {stop:async()=>{window.stops++;controller.abort()}}};`,
}
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {TaskWidgetProvider} from '${root}/apps/mobile/src/widgets/provider.tsx';import {updateMobilePreferences} from '${root}/apps/mobile/src/runtime/preferences/app-preferences.ts';import {LiveActivityProvider,useLiveActivities} from '${root}/apps/mobile/src/live-activities/provider.tsx';import {TerminalSession} from '${root}/apps/mobile/src/terminal/terminal-session.tsx';import {useForegroundInterval} from '${root}/apps/mobile/src/runtime/state/app-active.ts';import {decode,snapshotSchema,taskSchema,runtimeProfile} from '@dovo/protocol';window.controllers=0;window.activitySyncs=0;window.activityDisposals=0;window.pollers=0;window.pollStops=0;window.writes=[];window.commands=[];window.starts=0;window.stops=0;window.ticks=0;window.tickets=0;const task=decode(taskSchema,{id:'task',title:'Build',repositoryId:'',agentId:'',status:'running',createdAt:new Date().toISOString(),messages:[],files:[],draft:'',example:false});const profile=runtimeProfile({address:'http://computer.local:51464',token:'device-token-123456789'});window.runtime={ready:true,connection:profile.connection,call:async()=>{window.tickets++;return {ticket:'test'}},overviews:[{profile,connected:true,lastSeen:null,error:null,pulls:null,pullError:null,snapshot:decode(snapshotSchema,{revision:1,owner:false,workspace:{version:1,runtimeAddress:'',repositories:[],agents:[],tasks:[task],automations:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]})}]};function Clock(){window.setActivities=useLiveActivities().setEnabled;window.setWidgets=value=>updateMobilePreferences({widgetUpdates:value});useForegroundInterval(()=>window.ticks++,50);return null}const node=createRoot(document.getElementById('app'));const render=()=>flushSync(()=>node.render(<LiveActivityProvider><TaskWidgetProvider><Clock/><TerminalSession id="terminal"/></TaskWidgetProvider></LiveActivityProvider>));window.renderUpdates=render;window.unmount=()=>flushSync(()=>node.unmount());render();`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
  },
  nodePaths: [root + '/packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'native-mocks',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + '/apps/mobile',
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(
    () => window.writes.length === 1 && window.tickets === 1 && window.activitySyncs > 0,
  )
  await page.waitForTimeout(350)
  const initialSyncs = await page.evaluate(() => window.activitySyncs)
  // Assistant streaming changes the overview object, but not widget or activity content.
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      window.runtime = { ...window.runtime, overviews: structuredClone(window.runtime.overviews) }
      window.runtime.overviews[0].snapshot.workspace.tasks[0].draft = 'stream ' + i
      window.renderUpdates()
    }
  })
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.writes.length), 1)
  assert.equal(await page.evaluate(() => window.activitySyncs), initialSyncs)
  // Inactive pauses UI timers; a permission prompt must preserve the terminal.
  await page.evaluate(() => window.setAppState('inactive'))
  await page.waitForTimeout(100)
  const ticks = await page.evaluate(() => window.ticks)
  const syncs = await page.evaluate(() => window.activitySyncs)
  assert.equal(await page.evaluate(() => window.pollStops), 1)
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.ticks), ticks)
  assert.equal(await page.evaluate(() => window.activitySyncs), syncs)
  assert.equal(await page.evaluate(() => window.stops), 0)
  await page.evaluate(() => window.setAppState('active'))
  await page.waitForFunction((old) => window.ticks > old, ticks)
  assert.equal(await page.evaluate(() => window.tickets), 1)
  assert.equal(await page.evaluate(() => window.controllers), 1)
  assert.equal(await page.evaluate(() => window.pollers), 2)
  // A true background closes the terminal and suppresses native widget writes.
  await page.evaluate(() => window.setAppState('background'))
  await page.waitForFunction(() => window.stops === 1)
  await page.evaluate(() => {
    window.runtime.overviews[0].snapshot.workspace.tasks[0].title = 'Needs attention'
    window.renderUpdates()
  })
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.writes.length), 1)
  await page.evaluate(() => window.setAppState('active'))
  await page.waitForFunction(() => window.writes.length === 2 && window.tickets === 2)
  assert.equal(await page.evaluate(() => window.writes.at(-1).items[0].title), 'Needs attention')
  assert.equal(
    await page.evaluate(() => window.commands.some((code) => code.includes('disconnectTerminal'))),
    true,
  )
  // Rapid status changes coalesce to the newest visible snapshot.
  await page.evaluate(() => {
    window.runtime.overviews[0].snapshot.workspace.tasks[0].title = 'A'
    window.renderUpdates()
    window.runtime.overviews[0].snapshot.workspace.tasks[0].title = 'B'
    window.renderUpdates()
  })
  await page.waitForFunction(() => window.writes.length === 3)
  assert.equal(await page.evaluate(() => window.writes.at(-1).items[0].title), 'B')
  // Disabled native surfaces own no recurring work, even as task status keeps changing.
  await page.evaluate(() => {
    window.setActivities(false)
    window.setWidgets(false)
  })
  await page.waitForFunction(() => window.pollStops === 3)
  await page.waitForTimeout(350)
  const disabledSyncs = await page.evaluate(() => window.activitySyncs)
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      window.runtime.overviews[0].snapshot.workspace.tasks[0].title = 'Disabled ' + i
      window.renderUpdates()
    }
  })
  await page.waitForTimeout(1200)
  assert.equal(await page.evaluate(() => window.activitySyncs), disabledSyncs)
  assert.equal(await page.evaluate(() => window.pollers), 3)
  assert.equal(await page.evaluate(() => window.writes.length), 3)
  await page.evaluate(() => {
    window.setActivities(true)
    window.setWidgets(true)
  })
  await page.waitForFunction(() => window.pollers === 4 && window.writes.length === 4)
  assert.equal(await page.evaluate(() => window.writes.at(-1).items[0].title), 'Disabled 19')
  await page.evaluate(() => window.unmount())
  await page.waitForFunction(() => window.activityDisposals === 1)
  assert.equal(await page.evaluate(() => window.controllers), 1)
  assert.equal(await page.evaluate(() => window.pollStops), 4)
  assert.equal(await page.evaluate(() => window.stops), 2)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile energy: unchanged streams produce no widget writes; background timers and terminals stop; foreground resumes promptly; disabling widgets and activities stops their work and re-enabling restores the latest state.',
  )
} finally {
  await browser.close()
}
