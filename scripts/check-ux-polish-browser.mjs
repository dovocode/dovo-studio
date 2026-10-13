import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ProjectInstructionsDialog} from './src/dialogs/project-instructions-dialog';import {SavedPromptsDialog} from './src/dialogs/saved-prompts-dialog';import {TaskTemplatesDialog} from './src/dialogs/task-templates-dialog';import {CommitBar} from './src/review/commit-bar';import {copyTextToClipboard} from '@dovo/studio-ui/clipboard';window.copy=copyTextToClipboard;const root=createRoot(document.getElementById('app'));window.renderView=kind=>root.render(kind==='instructions'?<ProjectInstructionsDialog repositoryId="repo" onClose={()=>window.closeCount++}/>:kind==='prompts'?<SavedPromptsDialog repositoryId="repo" onClose={()=>window.closeCount++}/>:kind==='templates'?<TaskTemplatesDialog repositoryId="repo" onClose={()=>window.closeCount++}/>:<CommitBar task={{id:'task',repositoryId:'repo',status:'idle',files:[{path:'file'}]}}/>);`,
    resolveDir: root + 'packages/extension-tasks',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  target: 'es2022',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
  },
  plugins: [
    {
      name: 'fixtures',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/studio-core$/ }, () => ({
          path: 'core',
          namespace: 'fixtures',
        }))
        builder.onResolve({ filter: /^@dovo\/studio-ui$/ }, () => ({
          path: 'ui',
          namespace: 'fixtures',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixtures' }, ({ path }) => ({
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
          contents:
            path === 'core'
              ? `export const useWorkspace=()=>({connected:window.connected,request:window.request,workspace:window.workspace,setWorkspace:fn=>window.workspace=fn(window.workspace)});`
              : `import React from 'react';export const Button=({variant,size,...props})=><button {...props}/>;export const IconButton=({label,...props})=><button aria-label={label} {...props}/>;export const Input=React.forwardRef((props,ref)=><input ref={ref} {...props}/>);export const Textarea=React.forwardRef((props,ref)=><textarea ref={ref} {...props}/>);export const Dialog=({children})=><div role="dialog">{children}</div>;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h1>{children}</h1>;export const DialogDescription=({children})=><p>{children}</p>;`,
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<div id="app"></div>')
  await page.evaluate(() => {
    window.connected = true
    window.closeCount = 0
    window.confirm = () => false
    window.workspace = {
      repositories: [
        {
          id: 'repo',
          name: 'Project',
          prompts: [{ id: 'one', name: 'first', text: 'Original' }],
          templates: [],
        },
      ],
    }
    window.calls = []
    window.request = async (path, input) => {
      window.calls.push({ path, input })
      if (input.name === 'CLAUDE.md' && !window.retry) throw Error('Read failed')
      return { text: 'Original instructions', version: 'v1' }
    }
  })
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.evaluate(() => window.renderView('instructions'))
  await page.getByLabel('AGENTS.md', { exact: true }).fill('My draft')
  await page.getByRole('button', { name: 'CLAUDE.md', exact: true }).click()
  await page.getByText('Read failed').waitFor()
  assert.equal(await page.getByLabel('CLAUDE.md', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('CLAUDE.md', { exact: true }).isDisabled(), true)
  await page.evaluate(() => (window.retry = true))
  await page.getByRole('button', { name: 'Retry loading instructions' }).click()
  await page.getByLabel('CLAUDE.md', { exact: true }).fill('Second draft')
  await page.getByRole('button', { name: 'AGENTS.md · Unsaved', exact: true }).click()
  assert.equal(await page.getByLabel('AGENTS.md', { exact: true }).inputValue(), 'My draft')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  assert.equal(await page.evaluate(() => window.closeCount), 0)
  await page.evaluate(() => {
    window.connected = false
    window.renderView('instructions')
  })
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].find((x) => x.textContent === 'Review diff')
        ?.disabled,
  )
  await page.evaluate(() => window.renderView('prompts'))
  await page.getByRole('button', { name: 'Add prompt' }).click()
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Prompt 2 name',
  )
  await page.getByLabel('Prompt 2 name', { exact: true }).fill('FIRST')
  await page.getByLabel('Prompt 2 text', { exact: true }).fill('Second')
  assert.equal(await page.getByText('This name is already used.', { exact: true }).count(), 2)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Prompt 1 name',
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => window.closeCount), 0)
  await page.evaluate(() => window.renderView('templates'))
  await page
    .getByText(/Save as template/)
    .last()
    .waitFor()
  await page.evaluate(() => {
    window.connected = true
    window.renderView('commit')
    window.request = (path, input) => {
      window.calls.push({ path, input })
      return new Promise((resolve) => (window.resolveRequest = resolve))
    }
  })
  await page.getByRole('button', { name: 'Write the commit message' }).click()
  await page.getByLabel('Commit message', { exact: true }).fill('Handwritten')
  await page.evaluate(() => window.resolveRequest({ message: 'Generated' }))
  await page.getByRole('button', { name: 'Keep my message' }).waitFor()
  assert.equal(await page.getByLabel('Commit message', { exact: true }).inputValue(), 'Handwritten')
  await page.getByRole('button', { name: 'Keep my message' }).click()
  await page.getByRole('button', { name: 'Commit & push', exact: true }).click()
  await page.evaluate(() =>
    window.resolveRequest({ commit: '1234567890', pushError: 'Detailed push failure' }),
  )
  await page.getByRole('button', { name: 'Retry push' }).click()
  assert.equal(await page.evaluate(() => window.calls.at(-1).path), '/api/scm/push')
  assert.equal(
    await page.evaluate(() => window.calls.filter((x) => x.path === '/api/tasks/commit').length),
    1,
  )
  await page.evaluate(() => window.resolveRequest({ ok: true }))
  await page.getByText('Branch pushed.', { exact: true }).waitFor()
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    document.execCommand = () => {
      window.copied = document.activeElement.value
      return true
    }
    await window.copy('HTTP clipboard text')
  })
  assert.equal(await page.evaluate(() => window.copied), 'HTTP clipboard text')
  console.log(
    'UX checks passed: instruction draft retention, failed reads and retry, offline guards, dirty-close protection, prompt validation and focus, template guidance, generation races, push-only retry, HTTP clipboard.',
  )
} finally {
  await browser.close()
}
