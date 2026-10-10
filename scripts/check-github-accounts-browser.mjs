import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const controls = `import {cloneElement,isValidElement,useState,createContext,useContext} from 'react';export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)&&children.type!=='div'?cloneElement(children,{'aria-label':label}):children}</label>;export const ChoicePicker=({value,onValueChange,children,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const ModelSettings=()=>null;export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children})=><span>{children}</span>;export const Platform={OS:'ios'};export const StyleSheet={create:value=>value,hairlineWidth:1};export const useWindowDimensions=()=>({width:390,height:844,fontScale:1});export const SearchField=props=><input aria-label={props.label} value={props.value} onChange={e=>props.onChangeText?.(e.target.value)}/>;export const styles={row:{}};export const MobileThemeContext=createContext({styles,colors:{text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'},mode:'dark'});export const useTheme=()=>useContext(MobileThemeContext);export const colors={text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'};export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const Field=({label,value,onChangeText,multiline,editable})=><label>{label}{multiline?<textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/>}</label>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:async run=>{setBusy(true);try{await run()}catch(e){setError(String(e))}finally{setBusy(false)}}}};export const Dialog=({children})=><div role="dialog">{children}</div>;export const DialogContent=View;export const DialogDescription=Text;export const DialogHeader=View;export const DialogTitle=Text;export const useInsideSheet=()=>false;export const Sheet=({children,title})=><div role="dialog">{title}{children}</div>;export const AgentAvatar=()=>null;export const agentIconChoices={};export const PageHeader=({title})=><h1>{title}</h1>;export const ScreenHeader=PageHeader;export const TaskDefaultSettings=()=> <p>Default agent settings</p>;export const HarnessLabel=({agent})=><span>{agent.provider}</span>;export const ModelLabel=({agent})=><span>{agent.model}</span>;`

const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const shared = `export * from '@dovo/protocol';export {cliProfileOptions} from '${root}/packages/client-runtime/src/extensions/cli-profile-options.ts';export {clientScopeKey} from '${root}/packages/client-runtime/src/effects/request-scope.ts';import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;export const useWorkspace=()=>window.runtime;`
    const native = `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=><div>{children}</div>;`
    const mocks = {
      '@dovo/studio-core': shared,
      '@dovo/client-runtime': shared,
      '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
      '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
      '../../runtime/connection/provider': native,
      '@dovo/studio-ui': `export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/button.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/input.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/textarea.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/dialog.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/select.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/form-field.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/choice-picker.tsx'`,
      'react-native': controls,
      './directory-picker': `export const DirectoryPicker=()=>null;`,
      '../../screens/settings-group': `export const SettingsGroup=({children})=><div>{children}</div>;export const SettingsRow=({title,onPress})=><button onClick={onPress}>{title}</button>;`,
    }
    const built = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {decode,forgeConnectionSchema,forgeConnectionInputSchema} from '@dovo/protocol';import ${mobile ? 'Connections' : '{ForgeConnections as Connections}'} from '${root}/${mobile ? 'apps/mobile/src/scm/connections/connections' : 'packages/extension-scm/src/connections/forge-connections'}.tsx';let id=0;crypto.randomUUID=()=> '00000000-0000-4000-8000-'+String(++id).padStart(12,'0');window.saved=[];const request=async(path,input)=>{if(path.endsWith('cli-profiles/read'))return {profiles:[{id:'personal',name:'personal',active:true},{id:'work',name:'work'}]};if(path.endsWith('connections/read'))return {connections:window.saved};if(path.endsWith('connections/save')){const value=decode(forgeConnectionInputSchema,input);const result=decode(forgeConnectionSchema,{...value,id:crypto.randomUUID(),revision:crypto.randomUUID()});window.saved.push(result);return result};throw Error(path)};const source={profile:{id:'host',name:'Host',connection:{address:'http://host.local',token:'fixture'}},name:'Host',connected:true};window.runtime={connection:source.profile.connection,workspace:{repositories:[]},snapshot:{workspace:{repositories:[]}},overviews:[source],connected:true,request,read:request,callEffect:(path,input)=>Effect.tryPromise(()=>request(path,input)),readEffect:(path,input)=>Effect.tryPromise(()=>request(path,input))};createRoot(document.getElementById('app')).render(<Connections/>);`,
        loader: 'tsx',
        resolveDir: root,
      },
      bundle: true,
      write: false,
      jsx: 'automatic',
      format: 'iife',
      platform: 'browser',
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        '@dovo/protocol': root + '/packages/protocol/src/index.ts',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
      plugins: [
        {
          name: 'controls',
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path)
                ? { path, namespace: 'mock' }
                : path.includes('/ui/') && mobile
                  ? { path: 'native-controls', namespace: 'mock' }
                  : undefined,
            )
            b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents: path === 'native-controls' ? controls : mocks[path],
              loader: 'tsx',
              resolveDir: root,
            }))
          },
        },
      ],
    })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const add = () =>
      page
        .getByRole('button', { name: mobile ? 'Connect account' : 'Add connection', exact: true })
        .click()
    const save = () =>
      page
        .getByRole('button', { name: mobile ? 'Save account' : 'Save connection', exact: true })
        .click()
    await add()
    if (mobile)
      await page.getByRole('combobox', { name: 'Authentication' }).selectOption('gh-wrapper')
    else {
      await page.getByRole('combobox', { name: 'Authentication method', exact: true }).click()
      await page
        .getByRole('option', { name: 'GitHub CLI wrapper · environment selector', exact: true })
        .click()
    }
    await page.getByRole('textbox', { name: /Wrapper selectors/ }).fill('GH_ACCOUNT=work')
    await save()
    await page.waitForFunction(() => window.saved.length === 1)
    assert.deepEqual(await page.evaluate(() => window.saved[0].cliEnv), { GH_ACCOUNT: 'work' })
    assert.equal(await page.evaluate(() => window.saved[0].credential), 'gh-wrapper')
    await add()
    if (mobile)
      await page.getByRole('combobox', { name: 'GitHub user', exact: true }).selectOption('work')
    else {
      await page.getByRole('button', { name: 'GitHub user', exact: true }).click()
      await page.getByRole('option', { name: 'work', exact: true }).click()
    }
    await save()
    await page.waitForFunction(() => window.saved.length === 2)
    assert.equal(await page.evaluate(() => window.saved[1].cliProfile), 'work')
    assert.equal(await page.evaluate(() => window.saved[1].credential), 'gh')
    assert.equal(await page.evaluate(() => window.saved[1].cliEnv), undefined)
    await add()
    if (mobile)
      await page.getByRole('combobox', { name: 'Authentication' }).selectOption('environment')
    else {
      await page.getByRole('combobox', { name: 'Authentication method', exact: true }).click()
      await page
        .getByRole('option', { name: 'Token from runtime environment', exact: true })
        .click()
    }
    await page
      .getByRole('textbox', {
        name: mobile ? 'Token environment variable' : 'Environment variable',
        exact: true,
      })
      .fill('WORK_GH_TOKEN')
    await save()
    await page.waitForFunction(() => window.saved.length === 3)
    assert.equal(await page.evaluate(() => window.saved[2].tokenEnv), 'WORK_GH_TOKEN')
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} saves wrapper selectors, named gh accounts and token references`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
