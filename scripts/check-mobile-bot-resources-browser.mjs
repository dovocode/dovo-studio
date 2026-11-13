import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const native = `
import {useImperativeHandle} from 'react';
export const Keyboard={dismiss(){}};export const Alert={alert(){}};export const Platform={OS:'web'};export const StyleSheet={flatten:style=>style};export const useWindowDimensions=()=>({fontScale:1,width:390,height:844});
export const View=({children,testID})=><div data-testid={testID}>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const TextInput=({ref,accessibilityLabel,accessibilityHint,value,onChangeText,editable,multiline,testID})=>{useImperativeHandle(ref,()=>({focus(){}}));const props={'aria-label':accessibilityLabel,'aria-description':accessibilityHint,'data-testid':testID,value,disabled:editable===false,onChange:event=>onChangeText?.(event.target.value)};return multiline?<textarea {...props}/>:<input {...props}/>};
export const Pressable=({children,onPress,accessibilityLabel,disabled})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
`
const controls = `
export const SettingsSheet=({title,children,onClose})=><section role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close resource editor</button></section>;
export const Sheet=({title,children,onClose})=><section role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close resources</button></section>;
export const SettingsField=({label,value,onChangeText,editable,multiline,secureTextEntry})=>{const props={'aria-label':label,value,disabled:editable===false,onChange:event=>onChangeText(event.target.value)};return multiline?<textarea {...props}/>:<input type={secureTextEntry?'password':'text'} {...props}/>};
export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SettingsChoice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const useSettingsTheme=()=>({styles:{},colors:{}});export const useTheme=useSettingsTheme;
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {RegistryProvider} from '@effect/atom-react';
import {decode,botResourcesSchema,resourceSettingsSchema} from '@dovo/protocol';import {BotResources} from './apps/mobile/src/bots/bot-resources';
window.failSave=false;window.saves=[];
const initial=decode(botResourcesSchema,{mcpServers:[{name:'existing',enabled:true,transport:'stdio',command:'node',envValues:{API_TOKEN:'dovo-stored-secret:opaque'}}],skills:[],disabledMcpServers:[],disabledSkills:[]});
const inherited=decode(resourceSettingsSchema,{mcpServers:[{name:'shared-mcp',enabled:true,transport:'stdio',command:'node'}],skills:[{name:'shared-skill',enabled:true,description:'Shared skill',content:'Shared content'}]});
function App(){const [value,setValue]=useState(initial);window.resources=value;return <BotResources inherited={inherited} value={value} disabled={false} onClose={()=>{}} save={async update=>{if(window.failSave)throw Error('Resource revision conflict');const next=update(value);window.saves.push(next);setValue(next)}}/>};
createRoot(document.getElementById('app')).render(<RegistryProvider><App/></RegistryProvider>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
      '@effect/atom-react': root + 'apps/mobile/node_modules/@effect/atom-react/dist/index.js',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    { path: 'react-native', contents: native },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'resources/',
      contents: 'export const useRuntime=()=>({connected:true});',
    },
    {
      path: '../ui/content/open-link',
      importer: mobile + 'resources/',
      contents: 'export const useOpenAppLink=()=>async()=>{};',
    },
    { path: '../screens/settings-theme', importer: mobile + 'resources/', contents: controls },
    { path: '../screens/settings-controls', importer: mobile + 'resources/', contents: controls },
    { path: '../ui/theme', importer: mobile + 'resources/', contents: controls },
    { path: '../ui/theme', importer: mobile + 'bots/', contents: controls },
    { path: '../theme', importer: mobile + 'ui/', contents: controls },
    { path: '../ui/layout/sheet', importer: mobile + 'bots/', contents: controls },
    {
      path: './icon-button',
      importer: mobile + 'ui/controls/',
      contents: 'export const IconButton=()=>null;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Disable inherited mcp shared-mcp', exact: true }).click()
  await page
    .getByRole('button', { name: 'Restore inherited mcp shared-mcp', exact: true })
    .waitFor()
  assert.deepEqual(await page.evaluate(() => window.resources.disabledMcpServers), ['shared-mcp'])
  await page
    .getByRole('button', { name: 'Disable inherited skill shared-skill', exact: true })
    .click()
  assert.deepEqual(await page.evaluate(() => window.resources.disabledSkills), ['shared-skill'])
  await page.getByRole('button', { name: 'Restore inherited mcp shared-mcp', exact: true }).click()
  await page.getByRole('button', { name: 'Edit MCP existing', exact: true }).click()
  await page.getByText('Configured · value hidden', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Value for API_TOKEN', { exact: true }).count(), 0)
  await page.getByLabel('Executable', { exact: true }).fill('new-command')
  await page.evaluate(() => (window.failSave = true))
  await page.getByRole('button', { name: 'Save server', exact: true }).click()
  await page.getByText('Resource revision conflict', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Executable', { exact: true }).inputValue(), 'new-command')
  await page.evaluate(() => (window.failSave = false))
  await page.getByRole('button', { name: 'Save server', exact: true }).click()
  await page.getByRole('dialog', { name: 'MCP server', exact: true }).waitFor({ state: 'detached' })
  assert.equal(
    await page.evaluate(() => window.resources.mcpServers[0].envValues.API_TOKEN),
    'dovo-stored-secret:opaque',
  )
  assert.equal(await page.evaluate(() => window.resources.disabledMcpServers.length), 0)
  await page.getByRole('button', { name: 'Add Bot skill', exact: true }).click()
  await page.getByLabel('Skill name', { exact: true }).fill('release-check')
  await page.getByLabel('When to use', { exact: true }).fill('Check a release')
  await page.getByLabel('Skill instructions', { exact: true }).fill('Use the release checklist')
  await page.getByRole('button', { name: 'Save skill', exact: true }).click()
  await page.getByRole('button', { name: 'Edit skill release-check', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Disable skill release-check', exact: true }).click()
  await page.getByRole('button', { name: 'Enable skill release-check', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.resources.mcpServers[0].command), 'new-command')
  assert.equal(await page.evaluate(() => window.resources.disabledMcpServers.length), 0)
  await page.getByRole('button', { name: 'Add Bot skill', exact: true }).click()
  await page.getByLabel('Skill name', { exact: true }).fill('shared-skill')
  await page.getByLabel('When to use', { exact: true }).fill('Bot override')
  await page.getByLabel('Skill instructions', { exact: true }).fill('Bot-only instructions')
  await page.getByRole('button', { name: 'Save skill', exact: true }).click()
  await page
    .getByRole('button', { name: 'Reset skill shared-skill to inherited', exact: true })
    .click()
  assert.equal(
    await page.evaluate(() => window.resources.skills.some((item) => item.name === 'shared-skill')),
    false,
  )
  await page
    .getByRole('button', { name: 'Restore inherited skill shared-skill', exact: true })
    .click()
  assert.deepEqual(await page.evaluate(() => window.resources.disabledSkills), [])
  await page
    .getByRole('button', { name: 'Disable inherited skill shared-skill', exact: true })
    .click()
  assert.deepEqual(await page.evaluate(() => window.resources.disabledSkills), ['shared-skill'])
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Bot resources: real ResourceEditor and CredentialEditor preserve opaque credentials, failed edits, MCP/skill changes and Bot-only disabled inheritance.',
  )
} finally {
  await browser.close()
}
