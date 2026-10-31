import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mocks = {
  'react-native': `import React from 'react';const listeners=new Set();export const AppState={currentState:'active',addEventListener:(_,fn)=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)}}};window.appState=value=>{AppState.currentState=value;listeners.forEach(fn=>fn(value))};export const View=({children})=><div>{children}</div>;`,
  'react-native-webview': `import {forwardRef,useImperativeHandle,useEffect} from 'react';export const WebView=forwardRef((props,ref)=>{useImperativeHandle(ref,()=>({injectJavaScript:code=>window.commands.push(code)}));useEffect(()=>{window.mounts++;props.onMessage({nativeEvent:{data:JSON.stringify({type:'ready'})}})},[]);return null});`,
  '../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../runtime/preferences/app-preferences': `export const useMobilePreferences=()=>({terminalFontFamily:'',terminalFontSize:14});`,
  '../ui/theme': `export const useTheme=()=>({styles:{}});`,
  '../ui/content/text': `export const Text=()=>null;`,
  '@dovo/client-runtime': `export const startReconnecting=(run,onError)=>{const controller=new AbortController();void run(controller.signal,()=>{}).catch(onError);return {stop:async()=>controller.abort()}};`,
}
const built = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {TerminalSession} from '${root}/apps/mobile/src/terminal/terminal-session.tsx';import {runtimeProfile} from '${root}/packages/protocol/src/index.ts';window.commands=[];window.mounts=0;window.tickets=0;window.runtime={connection:runtimeProfile({address:'http://computer.local:51464',token:'device-token-123456789'}).connection,call:async()=>{window.tickets++;return {ticket:'ticket'}}};const root=createRoot(document.getElementById('app'));window.renderTerminal=visible=>flushSync(()=>root.render(<TerminalSession id="terminal" visible={visible}/>));window.renderTerminal(true);`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  alias: { react: root + '/packages/studio-ui/node_modules/react' },
  nodePaths: [root + '/packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'native-mocks',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
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
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.tickets === 1)
  await page.evaluate(() => window.renderTerminal(false))
  await page.waitForFunction(() =>
    window.commands.some((command) => command.includes('disconnectTerminal')),
  )
  assert.equal(await page.evaluate(() => window.mounts), 1)
  await page.evaluate(() => window.renderTerminal(true))
  await page.waitForFunction(() => window.tickets === 2)
  assert.equal(await page.evaluate(() => window.mounts), 1)
  await page.evaluate(() => window.appState('background'))
  await page.evaluate(() => window.renderTerminal(false))
  await page.evaluate(() => window.appState('active'))
  assert.equal(await page.evaluate(() => window.tickets), 2)
  await page.evaluate(() => window.renderTerminal(true))
  await page.waitForFunction(() => window.tickets === 3)
} finally {
  await browser.close()
}
