import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const core = `export const useSettingsDraft=()=>{};export {titleGenerationSettingsSchema,modelCatalogSchema,providerSchema} from '@dovo/protocol';export {providers} from '${root}/packages/studio-core/src/providers.ts';export const useWorkspace=()=>window.workspace;`
const ui = `export {SettingsSaveBar} from '${root}/packages/studio-ui/src/settings-layout.tsx';export {Button} from '${root}/packages/studio-ui/src/components/ui/button.tsx';export {Input} from '${root}/packages/studio-ui/src/components/ui/input.tsx';export {Textarea} from '${root}/packages/studio-ui/src/components/ui/textarea.tsx';export {ChoicePicker} from '${root}/packages/studio-ui/src/choice-picker.tsx';export {FormField} from '${root}/packages/studio-ui/src/components/form-field.tsx';export {ModelSettings} from '${root}/packages/studio-ui/src/model-settings.tsx';`
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {TitleSettings} from '${root}/packages/extension-agents/src/title-settings.tsx';window.documentSettings={harness:{provider:'codex',endpoint:'initial'},agentId:'',model:'title-model',reasoning:''};window.reads=0;window.writes=[];window.workspace={connected:true,workspace:{agents:[]},snapshot:{defaults:{},smartModelSelectionEnabled:true},request:async(path,input)=>{if(path.endsWith('/read')){window.reads++;return structuredClone(window.documentSettings)}if(path.endsWith('/save')){if(JSON.stringify(input.before)!==JSON.stringify(window.documentSettings))throw Error('Title settings changed on another device. Reload before saving.');window.writes.push(input);window.documentSettings=structuredClone(input.after);return structuredClone(input.after)}if(path==='/api/agents/models')return {models:[]};throw Error(path)}};const app=createRoot(document.getElementById('app'));window.showSelection=()=>app.render(<TitleSettings key='selection' selection/>);app.render(<TitleSettings/>);`,
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
  await page.getByText('Latest saved changes · your draft is kept', { exact: true }).waitFor()
  await page
    .getByText(
      '{"provider":"codex","endpoint":"initial"} → {"provider":"codex","endpoint":"remote edit"}',
      { exact: true },
    )
    .waitFor()
  const reload = page.getByRole('button', { name: 'Reload settings', exact: true })
  page.once('dialog', (dialog) => dialog.dismiss())
  await reload.click()
  assert.equal(await endpoint.inputValue(), 'local edit')
  assert.equal(await page.evaluate(() => window.reads), 2)
  page.once('dialog', (dialog) => dialog.accept())
  await reload.click()
  if (!(await endpoint.isVisible()))
    await page.getByText('Connection (optional)', { exact: true }).click()
  await page.waitForFunction(() => document.querySelector('input')?.value === 'remote edit')
  assert.equal(await page.evaluate(() => window.reads), 3)
  assert.equal(await page.getByRole('alert').count(), 0)
  await endpoint.fill('reconciled edit')
  await page.getByRole('button', { name: 'Save title settings', exact: true }).click()
  await page.getByText('Changes saved.', { exact: true }).waitFor()
  const write = await page.evaluate(() => window.writes.at(-1))
  assert.equal(write.before.harness.endpoint, 'remote edit')
  assert.equal(write.after.harness.endpoint, 'reconciled edit')
  await page.evaluate(() => {
    window.documentSettings = { inheritTitleModel: true, agentId: '', model: '', reasoning: '' }
    window.showSelection()
  })
  await page.getByText('Uses the title harness and model.', { exact: false }).waitFor()
  const provider = page.getByRole('button', {
    name: 'Scope, Tune & Maestro selector harness',
    exact: true,
  })
  await provider.click()
  await page.getByRole('option', { name: 'Codex', exact: true }).click()
  await page.getByRole('button', { name: 'Model', exact: true }).click()
  await page.getByRole('option', { name: 'Custom model…', exact: true }).click()
  await page.getByRole('textbox', { name: 'Custom model ID' }).fill('selector-model')
  await page.getByRole('button', { name: 'Save selection model', exact: true }).click()
  await page.getByText('Changes saved.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.documentSettings.model), 'selector-model')
  assert.equal(await page.evaluate(() => window.documentSettings.inheritTitleModel), false)
  await provider.click()
  await page.getByRole('option', { name: 'Inherit title model', exact: true }).click()
  await page.getByRole('button', { name: 'Save selection model', exact: true }).click()
  await page.waitForFunction(() => window.documentSettings.inheritTitleModel === true)
  assert.deepEqual(errors, [])
  console.log(
    'Title settings: conflict feedback, cancelled reload retains edits, confirmed reload refreshes baseline, and subsequent save passed.',
  )
  const mobileMocks = {
    '../ui/content/text': `export const Text=({children,accessibilityRole})=><div role={accessibilityRole}>{children}</div>;`,
    'react-native': `export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children,accessibilityRole})=><div role={accessibilityRole}>{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Alert={alert:(_title,_message,buttons)=>{if(!window.cancelAlert)buttons.at(-1).onPress()}};`,
    '../ui/theme': `const styles={};export const useTheme=()=>({styles,colors:{background:'#fff',border:'#ddd'}});`,
    '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../runtime/preferences/settings-target': `export const useSettingsDraft=(dirty)=>{window.hasDraft=dirty};`,
    '../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
    '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=effect=>Effect.runPromise(effect);`,
    './model-settings': `export const ModelSettings=()=>null;`,
    './acp-registry': `export const AcpRegistry=()=>null;`,
    '../screens/settings-controls': `export const SettingsChoice=()=>null;export const SettingsField=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/>;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    './settings-controls': `export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  }
  const mobileBuild = await build({
    stdin: {
      contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {TitleSettings} from '${root}/apps/mobile/src/agents/title-settings.tsx';window.documentSettings={harness:{provider:'opencode',endpoint:'initial'},agentId:'',model:'model',reasoning:''};window.writes=[];const call=async(path,input)=>{if(path.endsWith('/read'))return structuredClone(window.documentSettings);if(JSON.stringify(input.before)!==JSON.stringify(window.documentSettings))throw Error('Settings changed on another device');window.writes.push(input);window.documentSettings=structuredClone(input.after);return structuredClone(input.after)};window.runtime={connected:true,snapshot:{workspace:{agents:[]},defaults:{}},call,callEffect:(path,input)=>Effect.tryPromise({try:()=>call(path,input),catch:error=>error})};function App(){const [,render]=useState(0);window.setConnection=connected=>{window.runtime.connected=connected;render(value=>value+1)};return <TitleSettings/>}createRoot(document.getElementById('app')).render(<App/>);`,
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
    nodePaths: [root + '/packages/studio-ui/node_modules', root + '/apps/mobile/node_modules'],
    plugins: [
      {
        name: 'mobile-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            mobileMocks[path] ? { path, namespace: 'mobile-boundary' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'mobile-boundary' }, ({ path }) => ({
            contents: mobileMocks[path],
            loader: 'tsx',
            resolveDir: root + '/apps/mobile',
          }))
        },
      },
    ],
  })
  const mobilePage = await browser.newPage()
  mobilePage.setDefaultTimeout(6000)
  const mobileErrors = []
  mobilePage.on('pageerror', (error) => {
    mobileErrors.push(error.message)
    console.error(error.message)
  })
  await mobilePage.setContent('<div id="app"></div>')
  await mobilePage.addScriptTag({ content: mobileBuild.outputFiles[0].text })
  const mobileEndpoint = mobilePage.getByRole('textbox', {
    name: 'Title harness endpoint',
    exact: true,
  })
  try {
    await mobileEndpoint.fill('local edit')
  } catch (error) {
    throw new Error(
      `${error.message}\nMobile screen: ${await mobilePage.locator('body').innerText()}\nErrors: ${mobileErrors.join('; ')}`,
    )
  }
  await mobilePage.evaluate(() => window.setConnection(false))
  await mobilePage.evaluate(() => {
    window.documentSettings.harness.endpoint = 'remote edit'
    window.setConnection(true)
  })
  assert.equal(await mobileEndpoint.inputValue(), 'local edit')
  assert.equal(await mobilePage.evaluate(() => window.hasDraft), true)
  await mobilePage.getByRole('button', { name: 'Save title settings', exact: true }).click()
  await mobilePage.getByText('Latest saved changes · your draft is kept', { exact: true }).waitFor()
  assert.equal(await mobileEndpoint.inputValue(), 'local edit')
  await mobilePage.evaluate(() => (window.cancelAlert = true))
  await mobilePage.getByRole('button', { name: 'Reload settings', exact: true }).click()
  assert.equal(await mobileEndpoint.inputValue(), 'local edit')
  await mobilePage.evaluate(() => (window.cancelAlert = false))
  await mobilePage.getByRole('button', { name: 'Reload settings', exact: true }).click()
  await mobilePage.waitForFunction(() => document.querySelector('input').value === 'remote edit')
  await mobileEndpoint.fill('reconciled edit')
  await mobilePage.getByRole('button', { name: 'Save title settings', exact: true }).click()
  await mobilePage.waitForFunction(() => window.writes.length === 1)
  assert.equal(
    (await mobilePage.evaluate(() => window.writes[0])).before.harness.endpoint,
    'remote edit',
  )
  assert.deepEqual(mobileErrors, [])
  await mobilePage.close()
  console.log(
    'Mobile title settings: drafts survive reconnects, conflicts preserve edits, and explicit reload refreshes the save baseline passed (native boundaries mocked).',
  )
} finally {
  await browser.close()
}
