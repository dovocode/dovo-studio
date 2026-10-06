import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const state = `import {useState} from 'react';export const useApplicationState=useState;`
const controls = `import {useState,cloneElement,isValidElement} from 'react';export const Button=({children,onClick,disabled,...props})=><button disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)?cloneElement(children,{"aria-label":label}):children}</label>;export const ChoicePicker=({value,onValueChange,children,disabled,...props})=><select aria-label={props["aria-label"]} value={value} disabled={disabled} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const ModelSettings=()=>null;export const View=({children})=><div>{children}</div>;export const Text=({children})=><div>{children}</div>;export const styles={};export const useTheme=()=>({styles,colors,mode:'dark'});export const colors={text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'};export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Alert={alert:(title,message,buttons)=>buttons.at(-1).onPress?.()};export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const Field=({label,value,onChangeText,multiline,editable})=><label>{label}{multiline?<textarea aria-label={label} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/>}</label>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const Switch=({value,onValueChange,disabled})=><input type="checkbox" checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>;export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:async run=>{setBusy(true);setError('');try{await run()}catch(e){setError(String(e))}finally{setBusy(false)}}}}`
const mocks = {
  '@dovo/studio-core': `export const useWorkspace=()=>window.store;export const useSettingsDraft=()=>{};`,
  '@dovo/studio-core/state': state,
  '../state/application-state': state,
  '../connection/provider': `export const useRuntime=()=>window.store;export const RuntimeScope=({children})=>children;`,
  'react-native': controls,
  'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const built = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {TaskDefaultSettings} from '${root}/${mobile ? 'apps/mobile/src/runtime/preferences' : 'packages/studio-ui/src'}/task-default-settings.tsx';import {defaultTaskHarness} from '@dovo/protocol';const repo={id:'project',name:'Project',path:'/repo',branch:'main',gitIdentity:'github.com/team/repo'};window.writes=[];window.scopes={global:{taskDefaults:{harness:defaultTaskHarness('claude'),setupCommand:'global setup'},resources:{mcpServers:[],skills:[]},prompts:[{id:'review',name:'review',text:'Shared review'}]},environment:{},project:{},'environment-project':{}};const request=async(path,input)=>{if(path.endsWith('/read')){if(input.scope==='project'&&window.delayProject)await new Promise(resolve=>window.releaseProject=resolve);return {value:structuredClone(window.scopes[input.scope]),inherited:input.scope==='global'?{}:structuredClone(window.scopes.global),projectKey:'project:github.com/team/repo'}}if(path.endsWith('/save')){window.writes.push(input);window.scopes[input.scope]=structuredClone(input.after);return {value:input.after,inherited:{},projectKey:'project:github.com/team/repo'}}throw new Error(path)};window.store={connected:true,request,call:request};createRoot(document.getElementById('app')).render(<TaskDefaultSettings repository={repo} ${mobile ? '' : 'inline'}/>);`,
        loader: 'tsx',
        resolveDir: root,
      },
      bundle: true,
      write: false,
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        '@dovo/protocol': root + '/packages/protocol/src/index.ts',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules'],
      jsx: 'automatic',
      format: 'iife',
      platform: 'browser',
      plugins: [
        {
          name: 'mocks',
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) => {
              if (mocks[path]) return { path, namespace: 'mock' }
              if (
                /components\/ui\/(button|input|textarea)$|components\/form-field$|choice-picker$|model-settings$|ui\/controls\/(choice|field|action|switch|use-action)$|ui\/content\/text$|ui\/theme$/.test(
                  path,
                )
              )
                return { path: 'controls', namespace: 'mock' }
            })
            b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents: path === 'controls' ? controls : mocks[path],
              loader: 'tsx',
              resolveDir: root + '/apps/mobile',
            }))
          },
        },
      ],
    })
    const page = await browser.newPage()
    page.setDefaultTimeout(6000)
    let errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    if (mobile) await page.getByRole('button', { name: 'Task defaults', exact: true }).click()
    const scopes = page.getByLabel('Settings scope', { exact: true })
    await scopes.waitFor()
    assert.equal(await scopes.locator('option').count(), 4)
    assert.equal(await scopes.inputValue(), 'environment-project')
    await scopes.selectOption('global')
    await page.getByLabel('Setup command', { exact: true }).fill('global new setup')
    await page.getByLabel('Prompt text', { exact: true }).fill('Updated shared review')
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.getByText('Defaults saved for new tasks.', { exact: true }).waitFor()
    let write = await page.evaluate(() => window.writes.at(-1))
    assert.equal(write.scope, 'global')
    assert.equal(write.after.taskDefaults.setupCommand, 'global new setup')
    assert.equal(write.after.prompts[0].text, 'Updated shared review')
    assert.deepEqual(write.after.resources, { mcpServers: [], skills: [] })
    await scopes.selectOption('environment-project')
    await page.getByRole('button', { name: 'Override inherited #review', exact: true }).click()
    await page.getByLabel('Prompt text', { exact: true }).fill('Local override')
    await page
      .getByRole('button', { name: 'Reset task defaults to inherited settings', exact: true })
      .click()
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.getByText('Defaults saved for new tasks.', { exact: true }).waitFor()
    write = await page.evaluate(() => window.writes.at(-1))
    assert.equal(write.scope, 'environment-project')
    assert.deepEqual(write.after.taskDefaults, {})
    assert.equal(write.after.prompts[0].text, 'Local override')
    assert.equal(write.repositoryId, 'project')
    await page.evaluate(() => (window.delayProject = true))
    await scopes.selectOption('project')
    await page.waitForFunction(() => !!window.releaseProject)
    assert.equal(
      await page.getByRole('button', { name: 'Save defaults', exact: true }).isDisabled(),
      true,
    )
    await scopes.selectOption('global')
    await page.getByLabel('Setup command', { exact: true }).waitFor()
    await page.evaluate(() => window.releaseProject())
    assert.equal(await scopes.inputValue(), 'global')
    assert.equal(
      await page.getByLabel('Setup command', { exact: true }).inputValue(),
      'global new setup',
    )
    assert.deepEqual(errors, [])
    console.log(
      (mobile ? 'Mobile' : 'Desktop') +
        ': four scope selection, shared prompt editing, preserved resources, local prompt overrides, resetting defaults and stale read cancellation passed.',
    )
    await page.close()
  }
} finally {
  await browser.close()
}
