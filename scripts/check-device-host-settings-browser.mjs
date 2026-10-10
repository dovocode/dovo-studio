import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = `${root}/packages/studio-ui/src`
const mocks = {
  '@dovo/studio-core': `export const useWorkspace=()=>window.runtime;export const useSettingsDraft=()=>{};`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui':
    ['button', 'input', 'select', 'dialog']
      .map((name) => `export * from '${ui}/components/ui/${name}.tsx';`)
      .join('\n') +
    `\nexport * from '${ui}/settings-layout.tsx';export * from '${ui}/choice-picker.tsx';export * from '${ui}/components/form-field.tsx';`,
  './host-page': `export const HostPage=({children})=>children;`,
}
const built = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {decode} from '@dovo/protocol';import View from '${root}/packages/extension-runtime/src/device-hosts-view.tsx';window.saved={hosts:[]};window.calls=[];window.runtime={connected:true,connection:{address:'http://coding:3001'},runtimes:[{profile:{id:'coding',name:'Coding computer',connection:{address:'http://coding:3001',token:'local-secret'}}},{profile:{id:'mac',name:'Device Mac',connection:{address:'http://mac:3001',token:'paired-secret-never-render'}}}],request:async(path,input,schema,method)=>{window.calls.push({path,input,method});if(path==='/api/device-hosts/test')return decode(schema,{ok:true,checks:[{name:'SSH key authentication',ok:true,message:'Connected with key authentication'},{name:'iOS simulators',ok:true,message:'Xcode and companion ready'}]});if(method!=='GET'){window.saved={...input,hosts:input.hosts.map(({token,...host})=>({...host,hasToken:!!token||!!window.saved.hosts.find(h=>h.id===host.id)?.hasToken}))}}return decode(schema,window.saved)}};const uiRoot=createRoot(document.getElementById('app'));let viewRevision=0;window.remount=()=>uiRoot.render(<View key={++viewRevision}/>);window.remount();`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: `${root}/packages/studio-ui/node_modules/react`,
    '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
  },
  nodePaths: [`${root}/packages/studio-ui/node_modules`],
  plugins: [
    {
      name: 'context',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  assert.equal(await page.getByRole('button', { name: 'Add device host', exact: true }).count(), 0)
  await page.getByRole('switch', { name: 'Enable Device Hub', exact: true }).click()
  await page.getByRole('button', { name: 'Add device host', exact: true }).click()
  await page.getByRole('button', { name: 'Paired destination', exact: true }).click()
  await page.getByRole('option', { name: 'Device Mac', exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(),
    'Device Mac',
  )
  await page.getByRole('textbox', { name: 'SSH user', exact: true }).fill('dominic')
  await page
    .getByRole('textbox', { name: 'SSH key path (optional)', exact: true })
    .fill('~/.ssh/id_ed25519')
  await page.getByRole('button', { name: 'Test connection', exact: true }).click()
  await page.getByText('Connection ready', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'SSH host or alias', exact: true }).fill('device-mac')
  assert.equal(await page.getByText('Connection ready', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Save host', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
  const save = await page.evaluate(() =>
    window.calls.find(
      (c) => c.path === '/api/device-hosts' && c.method !== 'GET' && c.input.hosts.length > 0,
    ),
  )
  assert.equal(save.input.hosts[0].token, 'paired-secret-never-render')
  assert.equal(save.input.hosts[0].agentAccess, false)
  assert.equal(save.input.hosts[0].identityFile, '~/.ssh/id_ed25519')
  assert.equal(
    (await page.locator('body').innerText()).includes('paired-secret-never-render'),
    false,
  )
  await page.getByRole('button', { name: 'Default device host', exact: true }).click()
  await page.getByRole('option', { name: 'Device Mac', exact: true }).click()
  await page.waitForFunction(() => !!window.saved.defaultHostId)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: 'SSH host or alias', exact: true }).inputValue(),
    'device-mac',
  )
  // An SSH-reachable loopback address does not match any saved profile on the client.
  await page
    .getByRole('textbox', { name: 'Destination runtime address', exact: true })
    .fill('http://127.0.0.1:4317')
  await page.getByRole('button', { name: 'Save host', exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Save host', exact: true }).isEnabled(), true)
  await page.getByRole('spinbutton', { name: 'SSH port', exact: true }).fill('2222')
  assert.equal(
    await page.getByRole('button', { name: 'Save host', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Paired destination', exact: true }).click()
  await page.getByRole('option', { name: 'Device Mac', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Save host', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.waitForFunction(() => window.saved.hosts.length === 0 && !window.saved.defaultHostId)
  await page.evaluate(() => {
    window.saved = {
      enabled: true,
      revision: 0,
      hosts: Array.from({ length: 20 }, (_, i) => ({
        id: `host-${i}`,
        name: `Computer ${i}`,
        sshHost: 'mac.local',
        sshUser: 'dominic',
        sshPort: 22,
        runtimeAddress: 'http://127.0.0.1:4317',
        agentAccess: false,
        hasToken: false,
      })),
    }
    window.remount()
  })
  await page.getByText('Computer 19', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Add device host', exact: true }).isDisabled(),
    true,
  )
  assert.match(await page.locator('body').innerText(), /Pairing missing/)
  await page.getByRole('switch', { name: 'Enable Device Hub', exact: true }).click()
  await page.waitForFunction(() => window.saved.enabled === false)
  assert.equal(await page.getByRole('button', { name: 'Add device host', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Device host settings: pairing, key locality, readiness, save, default, edit and removal pass.',
  )
} finally {
  await browser.close()
}
