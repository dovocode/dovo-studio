import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const ui = root + 'packages/studio-ui/src'
const mocks = {
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core': `export * from '@dovo/protocol';export const WorkspaceRuntimeScope=({children})=>children;export const useRuntimeSources=()=>window.store.runtimes;export const useWorkspace=()=>window.store;`,
  '@dovo/studio-ui':
    ['button', 'input', 'dialog']
      .map((name) => `export * from '${ui}/components/ui/${name}';`)
      .join('\n') +
    `export {FormField} from '${ui}/components/form-field';export {ChoicePicker} from '${ui}/choice-picker';`,
}
const bundle = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `import {createRoot} from 'react-dom/client';import {JiraSourcesDialog} from '${root}packages/extension-scm/src/connections/jira-binding';
window.calls=[];window.saved=0;window.closed=0;const source={id:'jira',name:'Team backlog',site:'https://team.atlassian.net',project:'TEAM'};
const profile={id:'owner',name:'Owner',connection:{address:'http://owner',token:'paired'}};window.store={activeRuntimeId:'owner',connected:true,workspace:{jiraSources:[source]},runtimes:[{name:'Owner',profile,connected:true,snapshot:{workspace:{jiraSources:[source]}}}],refreshRuntime:async()=>{throw new Error('Disconnected after saving')},request:async(path,input)=>{window.calls.push({path,input});if(path.endsWith('/projects/read'))return{site:source.site,projects:[{key:'TEAM',name:'Team'}],truncated:false};if(path.endsWith('/sources/save'))return source;if(path.endsWith('/sources/remove'))return{ok:true};throw new Error(path)}};
const root=createRoot(document.getElementById('app'));window.render=()=>root.render(<JiraSourcesDialog key={window.mount??0} onClose={()=>window.closed++} onSaved={()=>window.saved++}/>);window.render();`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
  },
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: /Team backlog/ }).click()
  await page.getByLabel('Source name (optional)').fill('Keep this edited name')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: '← All issue sources', exact: true }).click()
  assert.equal(
    await page.getByLabel('Source name (optional)').inputValue(),
    'Keep this edited name',
  )
  await page.getByRole('button', { name: 'Save connection', exact: true }).click()
  await page
    .getByText('Saved successfully. Reconnect this computer to refresh its issue sources.', {
      exact: true,
    })
    .waitFor()
  assert.equal(
    await page.getByRole('alert').count(),
    0,
    'A failed read must not report the successful write as failed',
  )
  assert.equal(await page.evaluate(() => window.saved), 1)
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c.path.endsWith('/sources/save')).length),
    1,
  )
  await page.getByRole('button', { name: /Team backlog/ }).click()
  await page.getByRole('button', { name: 'Remove source', exact: true }).click()
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.path.endsWith('/sources/remove')).length,
    ),
    0,
  )
  await page.getByRole('button', { name: 'Confirm removal', exact: true }).click()
  await page.waitForFunction(
    () => window.calls.filter((c) => c.path.endsWith('/sources/remove')).length === 1,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Jira source recovery: dirty-close preservation, successful write with failed refresh, no resubmission and confirmed removal passed.',
  )
} finally {
  await browser.close()
}
