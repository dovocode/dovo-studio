import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
async function bundle(mobile) {
  const controls = `export const View=({children})=><div>{children}</div>;export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><input type="checkbox" aria-label={accessibilityLabel} checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SettingsField=({label,value,onChangeText,editable})=><label>{label}<input aria-label={label} value={value} disabled={!editable} onChange={e=>onChangeText(e.target.value)}/></label>;export const SettingsChoice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select>;`
  const mocks = {
    '@dovo/studio-core': `export * from '@dovo/protocol';export const useWorkspace=()=>({});`,
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
    '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;`,
    '../screens/settings-theme': `export const SettingsSheet=({children})=><section role="dialog">{children}</section>;export const useSettingsTheme=()=>({styles:{}});`,
    '../screens/settings-controls': controls,
    '../ui/content/text': controls,
    '../ui/controls/switch': controls,
    '../runtime/preferences/setting-source': `export const SettingSource=()=>null;`,
    'react-native': controls,
    './mcp-editor': `export const McpEditor=()=>null;`,
    './catalog-picker': `export const CatalogPicker=()=>null;`,
    './skill-editor': `export const SkillEditor=()=>null;`,
    '@dovo/studio-ui': `export const Button=({children,...props})=><button {...props}>{children}</button>;export const Input=props=><input {...props}/>;export const FormField=({label,children})=><label>{label}{children}</label>;export const Select=({value,onValueChange,children})=><select aria-label="When" value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const SelectTrigger=()=>null;export const SelectValue=()=>null;export const SelectContent=({children})=><>{children}</>;export const SelectItem=({value,children})=><option value={value}>{children}</option>;export const Switch=({checked,onCheckedChange,...props})=><input type="checkbox" checked={checked} onChange={e=>onCheckedChange(e.target.checked)} {...props}/>;export const SettingSource=()=>null;export const SettingsScopePage=()=>null;`,
  }
  const source = mobile
    ? 'apps/mobile/src/resources/hook-settings.tsx'
    : 'packages/extension-agents/src/resources/view.tsx'
  const built = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';import {HookSettings} from '${root}/${source}';
      window.saves=[];window.fail=false;
      function App(){const [resources,setResources]=useState({mcpServers:[],skills:[],hooks:[]});const inherited=[{name:'audit',event:'tool-complete',enabled:true,command:'node audit.mjs',timeoutSeconds:10}];const persist=async update=>{if(window.fail)throw new Error('Save failed');const next=update(resources);window.saves.push(next);setResources(next)};
      return <HookSettings hooks={resources.hooks} inherited={inherited} scope="project" origin={()=>'global'} disabled={false} save={persist} change={persist}/>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: `${root}/packages/studio-ui/node_modules/react`,
      'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    },
    nodePaths: [`${root}/packages/studio-ui/node_modules`],
    plugins: [
      {
        name: 'boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents: mocks[path],
            loader: 'tsx',
            resolveDir: `${root}/packages/studio-ui`,
          }))
        },
      },
    ],
  })
  return built.outputFiles[0].text
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1000, height: 850 } })
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle(mobile) })
    await page.getByRole('button', { name: 'Add hook', exact: true }).click()
    await page
      .getByRole('textbox', { name: mobile ? 'Hook name' : 'Name', exact: true })
      .fill('observer')
    assert.equal(
      await page.getByRole('combobox', { name: 'When', exact: true }).locator('option').count(),
      14,
    )
    await page.getByRole('combobox', { name: 'When', exact: true }).selectOption('tool-start')
    await page
      .getByRole('textbox', { name: mobile ? 'Hook command' : 'Command', exact: true })
      .fill('node on-tool.mjs')
    const matcher = page.getByRole('textbox', { name: /^Matcher \(optional\)/ })
    await matcher.fill('[')
    await page.getByRole('button', { name: 'Save hook', exact: true }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: /Invalid request data/ })
      .waitFor()
    assert.equal(await page.evaluate(() => window.saves.length), 0)
    await matcher.fill('^command$')
    await page.evaluate(() => {
      window.fail = true
    })
    await page.getByRole('button', { name: 'Save hook', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Save failed' }).waitFor()
    assert.equal(await matcher.count(), 1)
    await page.evaluate(() => {
      window.fail = false
    })
    await page.getByRole('button', { name: 'Save hook', exact: true }).click()
    await page.waitForFunction(() => window.saves.length === 1)
    assert.deepEqual(await page.evaluate(() => window.saves.at(-1).hooks[0]), {
      name: 'observer',
      enabled: true,
      event: 'tool-start',
      command: 'node on-tool.mjs',
      timeoutSeconds: 120,
      matcher: '^command$',
    })
    await page.getByRole('checkbox', { name: 'Enable hook observer', exact: true }).uncheck()
    await page.waitForFunction(() => window.saves.at(-1).hooks[0].enabled === false)
    await page.getByRole('button', { name: 'Override hook audit', exact: true }).click()
    await page.waitForFunction(() => window.saves.at(-1).hooks.length === 2)
    await page
      .getByRole('button', {
        name: mobile ? 'Reset hook audit' : 'Reset hook audit to inherited',
        exact: true,
      })
      .click()
    await page.waitForFunction(() => window.saves.at(-1).hooks.length === 1)
    await page.getByRole('button', { name: 'Edit hook observer', exact: true }).click()
    await page
      .getByRole('textbox', { name: mobile ? 'Hook name' : 'Name', exact: true })
      .fill('renamed')
    await page
      .getByRole('combobox', { name: 'When', exact: true })
      .selectOption('permission-request')
    await page.getByRole('button', { name: 'Save hook', exact: true }).click()
    await page.waitForFunction(() => window.saves.at(-1).hooks[0].name === 'renamed')
    assert.equal(await page.evaluate(() => window.saves.at(-1).hooks.length), 1)
    await page.getByRole('button', { name: 'Remove hook renamed', exact: true }).click()
    await page.waitForFunction(() => window.saves.at(-1).hooks.length === 0)
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'}: shared lifecycle choices, matcher validation, save failure recovery, toggle, inherited override/reset, rename and remove passed.`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
