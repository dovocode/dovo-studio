import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = `${root}/packages/studio-ui/src`
const mocks = {
  '@dovo/studio-core': `export const useWorkspace=()=>window.runtime;export const previewResultSchema={};`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui':
    ['button', 'input']
      .map((name) => `export * from '${ui}/components/ui/${name}.tsx';`)
      .join('\n') +
    `export * from '${ui}/components/form-field.tsx';export const SettingRow=({children})=>children;export const Toggle=()=>null;export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const Popover={};`,
}
const built = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {DeviceDeployment} from '${root}/packages/extension-tasks/src/browser/device-deployment.tsx';window.calls=[];window.forwards=[];window.fail=false;window.runtime={connected:true,request:async(path,input)=>{window.calls.push({path,input});if(path.endsWith('/forwards')){if(window.fail)throw Error('Unavailable');return {forwards:window.forwards.filter(f=>f.taskId===input.taskId)}}if(path.endsWith('/forward')){const f={...input,id:'forward-'+window.calls.length,ok:true,url:'http://127.0.0.1:'+input.remotePort,expiresAt:new Date(Date.now()+3600000).toISOString()};window.forwards.push(f);return f}if(path.endsWith('/stop'))window.forwards=window.forwards.filter(f=>f.id!==input.id);return {ok:true}}};const app=createRoot(document.getElementById('app'));let revision=0;window.show=(taskId='task-a')=>app.render(<DeviceDeployment key={++revision} inline taskId={taskId} device={{id:'host::android',hostId:'host',name:'Android',platform:'android',kind:'emulator',state:'booted'}}/>);window.hide=()=>app.render(null);window.show();`,
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
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const start = page.getByRole('button', { name: 'Start forwarding', exact: true })
  await start.click()
  await page.getByRole('button', { name: 'Stop forwarding', exact: true }).waitFor()
  const id = await page.evaluate(() => window.forwards[0].id)
  await page.evaluate(() => window.hide())
  await page.locator('form').waitFor({ state: 'detached' })
  await page.evaluate(() => window.show())
  await page.getByRole('button', { name: 'Stop forwarding', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.path.endsWith('/forward')).length),
    1,
  )
  await page.evaluate(() => window.show('task-b'))
  await start.waitFor()
  assert.equal(await page.getByRole('button', { name: 'Stop forwarding', exact: true }).count(), 0)
  await page.evaluate(() => window.show())
  await page.getByRole('button', { name: 'Stop forwarding', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Forwarding stopped.' }).waitFor()
  await start.waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.find((c) => c.path.endsWith('/stop')).input.id),
    id,
  )
  await page.getByRole('textbox', { name: 'App path', exact: true }).fill('build/app.apk')
  await page
    .getByRole('textbox', { name: 'App identifier (optional)', exact: true })
    .fill('com.example.my_app')
  await page.getByRole('button', { name: 'Install and launch', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Installed and launched' }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.calls.find((c) => c.path === '/api/previews/action').input.bundleId,
    ),
    'com.example.my_app',
  )
  await page.evaluate(() => {
    window.fail = true
    window.show()
  })
  await page.getByRole('alert').filter({ hasText: 'Could not restore forwards' }).waitFor()
  assert.equal(await start.isDisabled(), true)
  await page.evaluate(() => {
    window.fail = false
  })
  await page.getByRole('button', { name: 'Retry forwarding status', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'))
  assert.equal(await start.isEnabled(), true)
  assert.deepEqual(errors, [])
  console.log(
    'Desktop deployment: remount recovery, task isolation, stop identity, Android identifiers and recovery retry passed.',
  )
} finally {
  await browser.close()
}
