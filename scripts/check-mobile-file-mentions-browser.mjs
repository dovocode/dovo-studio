import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
const built = await bundleBrowser(
  {
    absWorkingDir: root,
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FileMentions} from '${mobile}src/tasks/conversation/components/file-mentions.tsx';
window.requests=[];
const call=(path,input)=>new Promise((resolve,reject)=>window.requests.push({input,resolve,reject}));
function App(){
  const [state,setState]=useState({text:'@old',taskId:'task1',activeId:'runtime1',connected:true,connection:{address:'http://one',token:'token'},call});
  window.update=changes=>setState(previous=>({...previous,...changes}));
  window.runtime=state;
  return <FileMentions taskId={state.taskId} text={state.text} caret={state.text.length} resources={{skills:[{name:'enabled',description:'Review changes',enabled:true},{name:'disabled',description:'Review security',enabled:false},{name:'review-empty',enabled:true}],mcpServers:[{name:'review-server',enabled:true}]}} onChange={text=>window.update({text})} onSideChat={state.sidechat ? text=>window.sidechat=text : undefined}/>;
}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: 'react-native',
      contents: `import React from 'react';export const ScrollView=({children})=><div>{children}</div>;export const Pressable=({children,accessibilityLabel,onPress})=><button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;`,
    },
    {
      path: '../../../runtime/connection/provider',
      importer: mobile,
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    {
      path: '../../../ui/content/text',
      importer: mobile,
      contents:
        "import React from 'react';export const Text=({children})=><span>{children}</span>;",
    },
    {
      path: '../../../ui/theme',
      importer: mobile,
      contents: 'export const useTheme=()=>({colors:{}});',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const waitRequests = (count) =>
    page.waitForFunction((expected) => window.requests.length >= expected, count)
  const update = (changes) => page.evaluate((value) => window.update(value), changes)
  const resolve = (index, file) =>
    page.evaluate(({ index, file }) => window.requests[index].resolve({ files: [file] }), {
      index,
      file,
    })
  const visible = (file) => page.getByRole('button', { name: `Mention file ${file}` })

  await waitRequests(1)
  await update({ text: '@new' })
  await waitRequests(2)
  await resolve(1, 'new.ts')
  await visible('new.ts').waitFor()
  await resolve(0, 'old.ts')
  await page.waitForTimeout(50)
  assert.equal(await visible('old.ts').count(), 0)
  assert.equal(await visible('new.ts').count(), 1)
  await update({ text: '@different' })
  await page.waitForFunction(() => !document.querySelector('[aria-label="Mention file new.ts"]'))

  for (const [changes, stale] of [
    [{ text: 'dismissed' }, 'dismissed.ts'],
    [{ connected: false }, 'disconnected.ts'],
    [{ taskId: 'task2' }, 'task.ts'],
    [{ activeId: 'runtime2', connection: { address: 'http://two', token: 'other' } }, 'runtime.ts'],
    [{ connection: { address: 'http://three', token: 'other' } }, 'connection.ts'],
  ]) {
    await update({ text: 'reset' })
    await page.waitForTimeout(20)
    await update({ text: '@pending', connected: true })
    const index = await page.evaluate(() => window.requests.length)
    await waitRequests(index + 1)
    await update(changes)
    await resolve(index, stale)
    await page.waitForTimeout(50)
    assert.equal(await visible(stale).count(), 0, `${JSON.stringify(stale)} must not appear`)
  }
  await update({ text: '$review' })
  const enabled = page.getByRole('button', { name: 'Mention skill enabled' })
  const disabled = page.getByRole('button', { name: 'Mention skill disabled' })
  const empty = page.getByRole('button', { name: 'Mention skill review-empty' })
  await enabled.waitFor()
  assert.equal(await enabled.locator('span').nth(1).innerText(), 'Skill · Review changes')
  assert.equal(
    await disabled.locator('span').nth(1).innerText(),
    'Skill · this message only · Review security',
  )
  assert.equal(await empty.locator('span').nth(1).innerText(), 'Skill')
  await update({ text: '@review' })
  const server = page.getByRole('button', { name: 'Mention MCP server review-server' })
  await server.waitFor()
  assert.equal(await server.locator('span').nth(1).innerText(), 'MCP server')
  assert.deepEqual(errors, [])
  await update({ text: '/sidechat', sidechat: true })
  await page.getByRole('button', { name: 'Command sidechat: Ask a side question' }).click()
  assert.equal(await page.evaluate(() => window.sidechat), '')
  await update({ text: 'Question\n/sidechat' })
  await page.getByRole('button', { name: 'Command sidechat: Ask a side question' }).click()
  assert.equal(await page.evaluate(() => window.sidechat), 'Question\n')
  await update({ text: '/sidechat', sidechat: false })
  assert.equal(
    await page.getByRole('button', { name: 'Command sidechat: Ask a side question' }).count(),
    0,
  )
  console.log('Mobile file mention request races and resource details passed')
} finally {
  await browser.close()
}
