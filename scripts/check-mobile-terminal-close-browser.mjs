import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {TerminalPane} from './src/terminal/terminal-pane';
window.closes=[];window.selected='one';window.task={id:'task',execution:'local'};
window.runtime={connected:true,connection:{address:'http://runtime',token:'paired'},snapshot:{terminals:[{id:'one',taskId:'task',title:'Shell'}]},callEffect:(path,input)=>Effect.tryPromise({try:async()=>{
if(path==='/api/terminals/close'){window.closes.push(input.id);if(window.hold)await new Promise(resolve=>{window.finish=resolve});if(window.fail)throw Error('Close failed');window.runtime.snapshot.terminals=window.runtime.snapshot.terminals.filter(t=>t.id!==input.id);window.render();return {ok:true}}
if(path==='/api/terminals'){const terminal={id:'two',taskId:'task',title:'Split'};window.runtime.snapshot.terminals.push(terminal);return terminal}throw Error('Unexpected request '+path)},catch:e=>e}),refresh:async()=>{},call:async(path,input)=>{
if(path!=='/api/terminals/update')throw Error('Unexpected request '+path);window.renames??=[];window.renames.push(input);
const terminal=window.runtime.snapshot.terminals.find(t=>t.id===input.id);
if(window.holdRename)await new Promise(resolve=>{window.finishRename=resolve});
if(window.failRename)throw Error('Rename failed');
Object.assign(terminal,{title:input.title??'Shell',customTitle:input.title});window.renameCompletions=(window.renameCompletions??0)+1;window.render();return terminal;
}};
const root=createRoot(document.getElementById('app'));window.render=()=>root.render(<TerminalPane task={window.task} selected={window.selected} visible={window.visible!==false} onSelect={id=>{window.selected=id;window.render()}}/>);window.render();`,
      loader: 'tsx',
      resolveDir: root + 'apps/mobile',
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    nodePaths: [
      root + 'apps/mobile/node_modules',
      root + 'packages/studio-ui/node_modules',
      root + 'node_modules',
    ],
  },
  [
    {
      path: 'react-native',
      contents: `export const View=({children})=><div>{children}</div>;export const ScrollView=View;`,
    },
    {
      path: '../ui/layout/sheet',
      importer: root + 'apps/mobile/src/terminal',
      contents: `export const Sheet=({title,children,onClose,busy})=><div role="dialog" aria-label={title}>{children}<button disabled={busy} onClick={onClose}>Dismiss</button></div>;`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../ui/controls/field',
      contents: `export const Field=({label,value,onChangeText,maxLength,autoFocus,editable,onSubmitEditing})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)} maxLength={maxLength} autoFocus={autoFocus} disabled={editable===false} onKeyDown={e=>{if(e.key==='Enter')onSubmitEditing?.()}}/>;`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../ui/controls/choice',
      contents: `export const Choice=()=>null;`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../runtime/connection/provider',
      contents: `export const useRuntime=()=>window.runtime;`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../runtime/state/application-state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../../runtime/state/application-state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../ui/theme',
      contents: `export const useTheme=()=>({colors:{},styles:{}});`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../ui/content/text',
      contents: `export const Text=({children})=><p>{children}</p>;`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../ui/controls/action',
      contents: `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    },
    {
      importer: root + 'apps/mobile',
      path: '../ui/controls/icon-button',
      contents: `export const IconButton=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    },
    {
      path: './terminal-session',
      importer: root + 'apps/mobile/src/terminal',
      contents: `export const TerminalSession=()=>null;`,
    },
    {
      path: '@dovo/client-runtime',
      contents: `import {Effect} from 'effect';export const runClientEffect=effect=>Effect.runPromise(effect);`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Rename Shell', exact: true }).click()
  const renameDialog = page.getByRole('dialog', { name: 'Rename terminal', exact: true })
  const titleInput = renameDialog.getByRole('textbox', { name: 'Terminal title' })
  await titleInput.fill('   ')
  assert.equal(
    await renameDialog.getByRole('button', { name: 'Save', exact: true }).isDisabled(),
    true,
  )
  await titleInput.fill('  Build server  ')
  await page.evaluate(() => {
    window.failRename = true
  })
  await renameDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await renameDialog.getByText('Rename failed', { exact: true }).waitFor()
  assert.equal(await titleInput.inputValue(), '  Build server  ')
  await page.evaluate(() => {
    window.failRename = false
    window.holdRename = true
  })
  await renameDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(() => !!window.finishRename)
  assert.equal(
    await renameDialog.getByRole('button', { name: 'Save', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await renameDialog.getByRole('button', { name: 'Dismiss', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => {
    window.holdRename = false
    window.finishRename()
  })
  await renameDialog.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Build server', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.renames), [
    { id: 'one', title: 'Build server' },
    { id: 'one', title: 'Build server' },
  ])
  await page.getByRole('button', { name: 'Rename Build server', exact: true }).click()
  await renameDialog.getByRole('button', { name: 'Use automatic title', exact: true }).click()
  await renameDialog.waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.renames.at(-1)), { id: 'one', title: null })
  // A delayed reply from one computer must leave a new computer's editor intact.
  await page.getByRole('button', { name: 'Rename Shell', exact: true }).click()
  await titleInput.fill('Old computer')
  await page.evaluate(() => {
    window.holdRename = true
    window.finishRename = null
  })
  await renameDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(() => !!window.finishRename)
  await page.evaluate(() => {
    window.runtime = {
      ...window.runtime,
      connection: { address: 'http://second', token: 'second' },
      snapshot: structuredClone(window.runtime.snapshot),
    }
    window.render()
  })
  await renameDialog.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Rename Shell', exact: true }).click()
  await titleInput.fill('New computer draft')
  await page.evaluate(() => {
    window.holdRename = false
    window.finishRename()
  })
  await page.waitForFunction(() => window.renameCompletions === 3)
  assert.equal(await page.evaluate(() => window.runtime.snapshot.terminals[0].title), 'Shell')
  assert.equal(await titleInput.inputValue(), 'New computer draft')
  await renameDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => {
    Object.assign(window.runtime.snapshot.terminals[0], { title: 'Shell', customTitle: null })
    window.render()
  })
  const close = page.getByRole('button', { name: 'Close terminal tab 1', exact: true })
  await close.click()
  await page.getByRole('dialog').waitFor()
  assert.deepEqual(await page.evaluate(() => window.closes), [])
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await close.click()
  await page.evaluate(() => {
    window.runtime = { ...window.runtime, connection: { address: 'http://other', token: 'other' } }
    window.render()
  })
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.closes), [])
  await page.getByRole('button', { name: 'Split left/right', exact: true }).click()
  await page.getByRole('button', { name: 'Close Split', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Rename Split pane', exact: true }).click()
  await titleInput.fill('Tests')
  await renameDialog.getByRole('button', { name: 'Save', exact: true }).click()
  await renameDialog.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Rename Tests pane', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.renames.at(-1)), { id: 'two', title: 'Tests' })
  await close.click()
  await page.getByRole('dialog', { name: 'Close 2 terminal panes?' }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Close Shell', exact: true }).click()
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click()
  await page.waitForFunction(() => window.closes.length === 1)
  assert.deepEqual(await page.evaluate(() => window.closes), ['one'])
  await close.click()
  await page.evaluate(() => {
    window.fail = true
  })
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click()
  await page.getByText('Close failed', { exact: true }).waitFor()
  await close.click()
  await page.evaluate(() => {
    window.task = { ...window.task, id: 'other-task' }
    window.render()
  })
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.closes), ['one', 'two'])
  await page.evaluate(() => {
    window.task = { ...window.task, id: 'task' }
    window.fail = false
    window.render()
  })
  await close.click()
  await page.evaluate(() => {
    window.hold = true
  })
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click()
  await page.waitForFunction(() => !!window.finish)
  assert.equal(await close.isDisabled(), true)
  await page.evaluate(() => {
    window.hold = false
    window.finish()
  })
  await page.waitForFunction(() => window.runtime.snapshot.terminals.length === 0)
  await page.evaluate(() => {
    window.runtime.snapshot.terminals = [
      { id: 'one', taskId: 'task', title: 'Shell' },
      { id: 'two', taskId: 'task', title: 'Split' },
    ]
    window.render()
  })
  await close.click()
  await page.getByRole('dialog', { name: 'Close 2 terminal panes?' }).waitFor()
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click()
  await page.waitForFunction(() => window.runtime.snapshot.terminals.length === 0)
  assert.deepEqual(await page.evaluate(() => window.closes.slice(-2)), ['one', 'two'])
  assert.deepEqual(errors, [])
  console.log(
    'Mobile terminal browser adapter: rename, reset, failed-save draft, pending-save guards, scoped late replies, split rename, cancel, pane capture, runtime/thread invalidation, errors and pending request guards passed.',
  )
} finally {
  await browser.close()
}
