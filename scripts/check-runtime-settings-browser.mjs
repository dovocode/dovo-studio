import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { fixture } from '../packages/runtime/dist/testing/fixture.js'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const f = await fixture()
const token = 'settings-browser-owner-token-at-least-32-characters'
const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
runtime.services.store.update(() => f.workspace)
const ui = `${root}/packages/studio-ui/src`
// Exercise actual Radix controls. Only runtime context and the surrounding host shell are adapted.
const mocks = {
  '@dovo/studio-core': `import {useEffect} from 'react';export {responses} from '@dovo/protocol';export {clientTaskScope} from '@dovo/client-runtime';export const useWorkspace=()=>window.runtime;export function useSettingsDraft(dirty){useEffect(()=>{window.dirty=dirty},[dirty])}`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui':
    ['button', 'input', 'textarea', 'dialog', 'select', 'checkbox']
      .map((name) => `export * from '${ui}/components/ui/${name}.tsx';`)
      .join('\n') +
    `\nexport * from '${ui}/settings-layout.tsx';export * from '${ui}/choice-picker.tsx';export * from '${ui}/components/form-field.tsx';export * from '${ui}/components/ai-elements/conversation.tsx';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export const MessageResponse=({children})=>children;`,
  './host-page': `export const HostPage=({children})=>children;`,
}
const built = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {decode} from '@dovo/protocol';import {SideQuestion} from '${root}/packages/extension-tasks/src/chat/thread/side-question.tsx';import Memory from '${root}/packages/extension-runtime/src/memory-view.tsx';import Worktrees from '${root}/packages/extension-runtime/src/worktrees-view.tsx';import {RunningTaskPreferences,PullRequestPreferences,ArtifactPreferences} from '${root}/packages/extension-runtime/src/runtime-preferences.tsx';import {Segmented} from '${ui}/settings-layout.tsx';const components={memory:Memory,worktrees:Worktrees,running:RunningTaskPreferences,pulls:PullRequestPreferences,artifacts:ArtifactPreferences};const app=createRoot(document.getElementById('app'));window.runtime={connected:true,request:async(path,input,schema)=>decode(schema,await window.callRuntime(path,input)),requestEffect:(path,input,schema)=>Effect.tryPromise({try:()=>window.runtime.request(path,input,schema),catch:error=>error})};window.show=name=>{const Component=components[name];app.render(<Component key={name}/>)};window.showSide=task=>{function SideDemo(){const [open,setOpen]=React.useState(true);const [drafts,setDrafts]=React.useState({});return <><button onClick={()=>setOpen(!open)}>Toggle panel</button>{open&&<SideQuestion task={task} drafts={drafts} setDrafts={setDrafts} onAddToComposer={()=>setOpen(false)}/>}</>};app.render(<SideDemo/>)};window.show('memory');window.showSegmented=()=>{function Demo(){const [value,set]=React.useState('one');return <Segmented label="Display" value={value} options={[['one','One'],['two','Two'],['three','Three']]} onChange={set}/>};app.render(<Demo/>)};`,
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
    '@dovo/client-runtime': `${root}/packages/client-runtime/src/index.ts`,
  },
  nodePaths: [`${root}/packages/studio-ui/node_modules`],
  plugins: [
    {
      name: 'runtime-context',
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
  page.on('pageerror', (error) => errors.push(error.message))
  let discard = true
  page.on('dialog', (dialog) => (discard ? dialog.accept() : dialog.dismiss()))
  await page.exposeFunction('callRuntime', async (path, input) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error)
    return value
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const chooseScope = async (name) => {
    await page.getByRole('button', { name: 'Memory scope', exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  const enabled = page.getByRole('switch', { name: 'Enable memory for this scope' })
  await enabled.waitFor()
  await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled)
  assert.equal(await enabled.isChecked(), false)
  await enabled.click()
  await page.waitForFunction(
    () =>
      document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true' &&
      !document.querySelector('[role="switch"]').disabled,
  )
  assert.equal(runtime.services.memory.settings().systemEnabled, true)
  await page.getByLabel('Key', { exact: true }).fill('testing')
  await page.getByLabel('Note', { exact: true }).fill('Use pnpm')
  await page.waitForFunction(() => window.dirty === true)
  discard = false
  await chooseScope('No project')
  assert.equal(await page.getByLabel('Note', { exact: true }).inputValue(), 'Use pnpm')
  assert.equal(await enabled.isChecked(), true)
  await page.getByRole('button', { name: 'Save note', exact: true }).click()
  await page.getByRole('button', { name: 'Edit testing', exact: true }).waitFor()
  await page.waitForFunction(() => window.dirty === false)
  await page.getByRole('button', { name: 'Edit testing', exact: true }).click()
  assert.equal(
    await page
      .getByLabel('Note', { exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  const current = runtime.services.memory.read({ scope: 'system', key: 'testing' })
  runtime.services.memory.write({
    scope: 'system',
    key: 'testing',
    content: 'Concurrent edit',
    expectedRevision: current.revision,
  })
  await page.getByLabel('Note', { exact: true }).fill('My stale edit')
  await page.getByRole('button', { name: 'Save note', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Memory changed' }).waitFor()
  discard = true
  await page.getByRole('button', { name: 'Cancel edit' }).click()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByText('Concurrent edit', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Delete testing', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(
    runtime.services.memory.read({ scope: 'system', key: 'testing' }).content,
    'Concurrent edit',
  )
  await page.getByRole('button', { name: 'Delete testing', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete note', exact: true }).click()
  await page.getByText('No saved notes in this scope.', { exact: true }).waitFor()
  // Regression: deleting entry 51 must return to the first page, retaining access to earlier notes.
  for (let index = 0; index < 51; index++)
    runtime.services.memory.write({
      scope: 'system',
      key: `note-${String(index).padStart(2, '0')}`,
      content: 'Durable note',
    })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Delete note-50', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete note', exact: true }).click()
  await page.getByRole('button', { name: 'Edit note-00', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^Edit note-/ }).count(), 50)
  await page.evaluate(() => window.show('running'))
  const limit = page.getByRole('spinbutton', { name: 'Maximum concurrent child agents' })
  await limit.waitFor()
  await limit.fill('0')
  await limit.press('Tab')
  await page.getByRole('alert').filter({ hasText: 'Enter a whole number' }).waitFor()
  assert.equal(runtime.services.preferences.get().maxActiveChildAgents, 4)
  await limit.fill('13')
  await limit.press('Enter')
  await page.waitForFunction(
    () =>
      document.querySelector('input[type="number"]')?.value === '13' &&
      !document.querySelector('input[type="number"]').disabled,
  )
  assert.equal(runtime.services.preferences.get().maxActiveChildAgents, 13)
  assert.equal(await page.getByRole('switch', { name: /watcher/ }).count(), 0)
  await page.evaluate(() => window.show('pulls'))
  const watcher = page.getByRole('switch', {
    name: 'Pipeline watcher (experimental)',
    exact: true,
  })
  await watcher.waitFor()
  await watcher.click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="switch"]')].some(
      (el) =>
        el.getAttribute('aria-label') === 'Pipeline watcher (experimental)' &&
        el.getAttribute('aria-checked') === 'true' &&
        !el.disabled,
    ),
  )
  assert.equal(runtime.services.preferences.get().enablePipelineWatching, true)
  await page.evaluate(() => window.show('artifacts'))
  const retention = page.getByRole('combobox', { name: 'Artifacts when settled', exact: true })
  await retention.click()
  await page.getByRole('option').filter({ hasText: '7 days' }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('[role="combobox"]').textContent.includes('7 days') &&
      !document.querySelector('[role="combobox"]').disabled,
  )
  assert.equal(runtime.services.preferences.get().settledArtifactRetention, '7-days')
  await page.evaluate(() => window.show('worktrees'))
  await page.getByRole('checkbox', { name: 'Show orphaned only', exact: true }).click()
  await page.getByText('No orphaned worktrees on this computer.', { exact: true }).waitFor()
  await page.evaluate(() => window.showSegmented())
  await page.getByRole('radio', { name: 'One', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(
    await page.getByRole('radio', { name: 'Two', exact: true }).getAttribute('aria-checked'),
    'true',
  )
  assert.equal(
    await page
      .getByRole('radio', { name: 'Two', exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  )
  const sideTask = runtime.services.tasks.create({
    title: 'Side chat browser',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  runtime.services.titles.saveSideChat({ id: sideTask.id, title: 'Review idea' })
  await page.evaluate((task) => window.showSide(task), runtime.services.store.task(sideTask.id))
  await page.getByLabel('Side question', { exact: true }).fill('Unfinished question')
  await page.getByRole('button', { name: 'Toggle panel', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle panel', exact: true }).click()
  assert.equal(
    await page.getByLabel('Side question', { exact: true }).inputValue(),
    'Unfinished question',
  )
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByText('Draft saved with this thread.', { exact: true }).waitFor()
  assert.equal(runtime.services.store.task(sideTask.id).sideChats[0].draft, 'Unfinished question')
  assert.deepEqual(errors, [])
  console.log(
    'Runtime settings: real Radix Switch/Select/Dialog/Checkbox, memory scopes/drafts/conflicts/pagination, child limit, watcher placement, segmented keyboard navigation and side-chat draft retention/save passed.',
  )
} finally {
  await browser.close()
  await runtime.close()
  await f.cleanup()
}
