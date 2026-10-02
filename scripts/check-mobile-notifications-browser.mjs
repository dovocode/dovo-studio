import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const require = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const mocks = {
  'react-native': `export const Platform={OS:'ios'};export const AppState={currentState:'active',addEventListener:(_,fn)=>{window.foreground=()=>fn('active');return{remove(){}}}};`,
  expo: `export const requireOptionalNativeModule=()=>({});`,
  'expo-constants': `export default {expoConfig:{extra:{pushEnvironment:'sandbox'}}};`,
  'expo-router': `export const router={push:target=>window.routes.push(target)};`,
  '@react-native-async-storage/async-storage': `export default {getItem:async()=> 'true',setItem:async()=>{}};`,
  'expo-notifications': `export const setNotificationCategoryAsync=async()=>{};export const setNotificationHandler=()=>{};export const getLastNotificationResponseAsync=async()=>null;export const clearLastNotificationResponseAsync=async()=>{};export const addNotificationResponseReceivedListener=fn=>{window.notification=fn;return{remove(){}}};export const getPermissionsAsync=async()=>({granted:window.permitted});export const requestPermissionsAsync=getPermissionsAsync;export const getDevicePushTokenAsync=async()=>({data:'native-token'});export const addPushTokenListener=fn=>{window.rotate=token=>fn({data:token});return{remove(){}}};`,
  '../runtime/connection/provider': `import {createContext,useContext} from 'react';export const Context=createContext(null);export const useRuntime=()=>useContext(Context);`,
  '../runtime/state/application-state': `import {useState,useRef} from 'react';export function useApplicationState(initial){const[value,set]=useState(initial);const ref=useRef(value);return[value,next=>{ref.current=next;set(next)},ref]};`,
}
const result = await build({
  stdin: {
    contents: `import {useState} from 'react';import{createRoot}from'react-dom/client';import{PushNotificationProvider,usePushNotifications}from'./src/notifications/provider.tsx';import{Context}from'../runtime/connection/provider';window.requests=[];window.finishes=[];window.routes=[];window.permitted=true;function Controls(){const state=usePushNotifications();window.toggle=state.setEnabled;window.state=state;return null};function App(){const[credential,setCredential]=useState('first');window.credential=setCredential;const profile={id:'host',name:'Host',connection:{address:'http://host',token:credential}};const runtime={ready:true,profiles:[profile],overviews:[{profile,connected:true}],readRuntime:async(profile,path,input)=>new Promise(resolve=>{window.requests.push({credential:profile.connection.token,path,input});window.finishes.push(resolve)})};return<Context.Provider value={runtime}><PushNotificationProvider><Controls/></PushNotificationProvider></Context.Provider>};createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: fileURLToPath(new URL('../apps/mobile/', import.meta.url)),
    loader: 'tsx',
  },
  alias: {
    react: dirname(require.resolve('react/package.json')),
    'react-dom': dirname(require.resolve('react-dom/package.json')),
  },
  plugins: [
    {
      name: 'native-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'native-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'native-environment' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.evaluate(() => {
    const original = window.setInterval
    window.setInterval = (fn, delay) => {
      window.poll = fn
      return original(fn, delay)
    }
  })
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const requests = (count) =>
    page.waitForFunction((count) => window.requests.length === count, count)
  const finish = (index) =>
    page.evaluate(
      (index) =>
        window.finishes[index]({ ok: true, configured: true, registered: true, error: null }),
      index,
    )
  await requests(1)
  await page.evaluate(() => window.toggle(false))
  await page.waitForFunction(() => window.state.enabled === false)
  await finish(0)
  await requests(2)
  if ((await page.evaluate(() => window.requests[1].path)) !== '/api/notifications/remove')
    throw new Error('Disabling during registration did not unregister')
  await finish(1)
  await page.waitForFunction(() => !window.state.busy)
  await page.evaluate(() => window.toggle(true))
  await requests(3)
  await finish(2)
  await page.waitForFunction(() => !window.state.busy)
  await page.evaluate(() => window.credential('second'))
  await page.waitForTimeout(50)
  await page.evaluate(() => window.foreground())
  await requests(4)
  await page.evaluate(() => window.rotate('rotated-token'))
  await finish(3)
  await requests(5)
  const rotated = await page.evaluate(() => window.requests[4])
  if (rotated.credential !== 'second' || rotated.input.token !== 'rotated-token')
    throw new Error('Rotation used stale registration or credentials')
  await finish(4)
  await page.evaluate(() => {
    window.permitted = false
    window.foreground()
  })
  await requests(6)
  if ((await page.evaluate(() => window.requests[5].path)) !== '/api/notifications/remove')
    throw new Error('Revoked permission left remote registration enabled')
  await finish(5)
  await page.evaluate(() => {
    window.permitted = true
    window.poll()
  })
  await requests(7)
  await finish(6)
  await page.waitForFunction(() => window.state.error === '')
  await page.evaluate(() => {
    const response = {
      notification: {
        request: {
          identifier: 'question-notification',
          content: {
            data: {
              runtimeId: 'host',
              taskId: 'thread',
              inputType: 'question',
              inputId: 'specific-question',
            },
          },
        },
      },
    }
    window.notification(response)
    window.notification(response)
  })
  const routes = await page.evaluate(() => window.routes)
  if (routes.length !== 1 || routes[0].params.questionId !== 'specific-question')
    throw new Error('Question routing duplicated or lost its identity')
  await page.evaluate(() =>
    window.notification({
      notification: {
        request: {
          identifier: 'removed-host',
          content: { data: { runtimeId: 'removed', taskId: 'thread' } },
        },
      },
    }),
  )
  if ((await page.evaluate(() => window.routes.at(-1).params.runtimeId)) !== 'removed')
    throw new Error('Removed computer notification was silently lost')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Mobile push: disable during registration, reconnect, token rotation, permission revoke/restore, and exact question routing passed.',
  )
} finally {
  await browser.close()
}
