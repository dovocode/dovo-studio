import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const core = `export {titleGenerationSettingsSchema,modelCatalogSchema,providerSchema} from '@dovo/protocol';export {providers} from '${root}/packages/studio-core/src/providers.ts';export const useWorkspace=()=>window.workspace;`
const ui = `export {Button} from '${root}/packages/studio-ui/src/components/ui/button.tsx';export {Input} from '${root}/packages/studio-ui/src/components/ui/input.tsx';export {Textarea} from '${root}/packages/studio-ui/src/components/ui/textarea.tsx';export {ChoicePicker} from '${root}/packages/studio-ui/src/choice-picker.tsx';export {FormField} from '${root}/packages/studio-ui/src/components/form-field.tsx';export {ModelSettings} from '${root}/packages/studio-ui/src/model-settings.tsx';`
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {TitleSettings} from '${root}/packages/extension-agents/src/title-settings.tsx';window.documentSettings={harness:{provider:'codex',endpoint:'initial'},agentId:'',model:'',reasoning:''};window.reads=0;window.writes=[];window.workspace={connected:true,workspace:{agents:[]},snapshot:{defaults:{}},request:async(path,input)=>{if(path.endsWith('/read')){window.reads++;return structuredClone(window.documentSettings)}if(path.endsWith('/save')){if(JSON.stringify(input.before)!==JSON.stringify(window.documentSettings))throw Error('Title settings changed on another device. Reload before saving.');window.writes.push(input);window.documentSettings=structuredClone(input.after);return structuredClone(input.after)}if(path==='/api/agents/models')return {models:[]};throw Error(path)}};createRoot(document.getElementById('app')).render(<TitleSettings/>);`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  platform: 'browser',
  format: 'iife',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
  },
  nodePaths: [root + '/packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'workspace-fixture',
      setup(builder) {
        const mocks = {
          './acp-registry': 'export const AcpRegistry=()=>null;',
          '@dovo/studio-core': core,
          '@dovo/studio-ui': ui,
          '@dovo/studio-core/state': "export {useState as useApplicationState} from 'react';",
        }
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'fixture' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('Connection (optional)', { exact: true }).click()
  const endpoint = page.getByRole('textbox', { name: 'Executable or server URL', exact: true })
  await endpoint.fill('local edit')
  await page.evaluate(() => {
    window.documentSettings.harness.endpoint = 'remote edit'
  })
  await page.getByRole('button', { name: 'Save title settings', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'Title settings changed on another device' })
    .waitFor()
  const reload = page.getByRole('button', { name: 'Reload settings', exact: true })
  page.once('dialog', (dialog) => dialog.dismiss())
  await reload.click()
  assert.equal(await endpoint.inputValue(), 'local edit')
  assert.equal(await page.evaluate(() => window.reads), 1)
  page.once('dialog', (dialog) => dialog.accept())
  await reload.click()
  if (!(await endpoint.isVisible()))
    await page.getByText('Connection (optional)', { exact: true }).click()
  await page.waitForFunction(() => document.querySelector('input')?.value === 'remote edit')
  assert.equal(await page.evaluate(() => window.reads), 2)
  assert.equal(await page.getByRole('alert').count(), 0)
  await endpoint.fill('reconciled edit')
  await page.getByRole('button', { name: 'Save title settings', exact: true }).click()
  await page.getByText('Title settings saved.', { exact: true }).waitFor()
  const write = await page.evaluate(() => window.writes.at(-1))
  assert.equal(write.before.harness.endpoint, 'remote edit')
  assert.equal(write.after.harness.endpoint, 'reconciled edit')
  assert.deepEqual(errors, [])
  console.log(
    'Title settings: conflict feedback, cancelled reload retains edits, confirmed reload refreshes baseline, and subsequent save passed.',
  )
} finally {
  await browser.close()
}
