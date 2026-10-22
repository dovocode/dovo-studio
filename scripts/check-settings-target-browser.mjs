import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const state = `export {useState as useApplicationState} from 'react';`
const controls = `import {cloneElement,isValidElement,useState,createContext,useContext} from 'react';export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)?cloneElement(children,{'aria-label':label}):children}</label>;export const ChoicePicker=({value,onValueChange,children,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const ModelSettings=()=>null;export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children})=><div>{children}</div>;export const Platform={OS:'ios'};export const Sheet=({children})=>children;export const useInsideSheet=()=>false;export const Icon=()=> <span aria-hidden='true'/>;export const StyleSheet={create:value=>value,hairlineWidth:1};export const useWindowDimensions=()=>({width:390,height:844,fontScale:1});export const SearchField=props=><input aria-label={props.label} value={props.value} onChange={e=>props.onChangeText?.(e.target.value)}/>;export const styles={};export const MobileThemeContext=createContext({styles,colors:{text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'},mode:'dark'});export const useTheme=()=>useContext(MobileThemeContext);export const colors={text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'};export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Alert={alert:(title,message,buttons)=>buttons.at(-1).onPress?.()};export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const Field=({label,value,onChangeText,multiline,editable})=><label>{label}{multiline?<textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>}</label>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const Switch=({value,onValueChange,disabled})=><input type="checkbox" checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>;export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:async run=>{setBusy(true);try{await run()}catch(e){setError(String(e))}finally{setBusy(false)}}}};`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const base = mobile
      ? root + '/apps/mobile/src/runtime/preferences'
      : root + '/packages/studio-core/src'
    const header = mobile ? 'ScopedSettings' : 'SettingsScopePage'
    const core = `import {createContext,useContext} from 'react';export {SettingsTargetProvider,useSettingsTarget,useOptionalSettingsTarget,useSettingsDraft} from '${root}/packages/studio-core/src/settings-target.tsx';const Scope=createContext(null);export const useWorkspace=()=>useContext(Scope)||window.runtime;export const WorkspaceScope=({profile,children})=>{const entry=window.sources.find(entry=>entry.profile.id===profile.id);return <Scope.Provider value={{...window.runtime,activeRuntimeId:profile.id,snapshot:entry.snapshot,connected:entry.connected,request:(path,input)=>window.request(profile.id,path,input)}}><div data-owner={profile.id}>{children}</div></Scope.Provider>};`
    const nativeRuntime = `import {createContext,useContext} from 'react';const Scope=createContext(null);export const useRuntime=()=>useContext(Scope)||window.runtime;export const RuntimeScope=({runtimeId,children})=>{const entry=window.sources.find(entry=>entry.profile.id===runtimeId);return <Scope.Provider value={{...window.runtime,activeId:runtimeId,snapshot:entry.snapshot,connected:entry.connected,call:(path,input)=>window.request(runtimeId,path,input)}}><div data-owner={runtimeId}>{children}</div></Scope.Provider>};`
    const mocks = {
      '@dovo/studio-core': core,
      './workspace/provider': `export const useWorkspace=()=>window.runtime;`,
      './workspace/runtime-sources': `export const useRuntimeSources=()=>window.sources;`,
      './runtime/application-state': state,
      '@dovo/studio-core/state': state,
      '../state/application-state': state,
      '../connection/provider': nativeRuntime,
      'react-native': controls,
      'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
    }
    const built = await build({
      stdin: {
        contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {SettingsTargetProvider${mobile ? ',ScopedSettings' : ''}} from '${base}/settings-target.tsx';${mobile ? '' : `import {SettingsScopePage} from '${root}/packages/studio-ui/src/settings-scope-page.tsx';`}import {TaskDefaultSettings} from '${mobile ? base : root + '/packages/studio-ui/src'}/task-default-settings.tsx';const repo={id:'mac-repo',name:'Shared project',path:'/mac/repo',branch:'main',gitIdentity:'github.com/team/repo'};window.sources=[{profile:{id:'mac',name:'Mac',connection:{address:'http://mac.local',token:'test-token'}},name:'Mac',scope:'mac',connected:true,snapshot:{defaults:{},workspace:{repositories:[repo,{id:'local-folder',name:'Local folder',path:'/mac/folder',kind:'folder'}]}}},{profile:{id:'linux',name:'Linux',connection:{address:'http://linux.local',token:'test-token'}},name:'Linux',scope:'linux',connected:true,snapshot:{defaults:{scopedSettings:{environment:{taskDefaults:{setupCommand:'linux setup'}},shared:[]}},workspace:{repositories:[{...repo,id:'linux-repo',path:'/linux/repo'}]}}},{profile:{id:'empty',name:'Empty',connection:{address:'http://empty.local',token:'test-token'}},name:'Empty',scope:'empty',connected:true,snapshot:{defaults:{},workspace:{repositories:[]}}}];window.writes=[];window.request=async(host,path,input)=>{if(path.endsWith('/read'))return {value:{taskDefaults:{setupCommand:'scope setup'}},inherited:{taskDefaults:{}},projectKey:'project:github.com/team/repo'};if(path.endsWith('/save')){window.writes.push({host,...input});return {value:input.after,inherited:{}}}throw Error(path)};window.runtime={runtimes:window.sources,overviews:window.sources,activeId:'mac',activeRuntimeId:'mac',snapshot:window.sources[0].snapshot,connected:true,readRuntime:(profile,path,input)=>window.request(profile.id,path,input)};const savedSources=window.sources;function App(){const [revision,setRevision]=useState(0);window.configureSources=(count,offline=false)=>{window.sources=savedSources.slice(0,count).map((entry,index)=>({...entry,connected:!(offline&&index===count-1)}));window.runtime={...window.runtime,runtimes:window.sources,overviews:window.sources};setRevision(value=>value+1)};const [page,setPage]=useState('defaults');return <SettingsTargetProvider><button onClick={()=>setPage('defaults')}>Defaults page</button><button onClick={()=>setPage('tools')}>Tools page</button><${header} ${mobile ? '' : 'title={page} description="Scoped settings"'}>{selection=>page==='defaults'?<TaskDefaultSettings inline scope={selection.scope} repository={selection.repository}/>:<p data-testid="target">{selection.scope}:{selection.repository?.id||''}</p>}</${header}></SettingsTargetProvider>}createRoot(document.getElementById('app')).render(<App/>);`,
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
      nodePaths: [root + '/packages/studio-ui/node_modules'],
      plugins: [
        {
          name: 'mocks',
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) => {
              if (/ui\/layout\/sheet$/.test(path)) return { path: 'controls', namespace: 'mock' }
              if (mocks[path]) return { path, namespace: 'mock' }
              if (
                /components\/ui\/(button|input|textarea)$|components\/form-field$|choice-picker$|model-settings$|ui\/controls\/(choice|field|action|switch|use-action|icon)$|ui\/content\/text$|ui\/theme$/.test(
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
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    page.on('dialog', (dialog) => dialog.accept())
    await page.getByText('Editing All projects on all machines', { exact: true }).waitFor()
    await page.getByText('Shared across paired machines', { exact: true }).waitFor()
    const projects = page.getByLabel(mobile ? 'Project' : 'Settings project', { exact: true })
    const environments = page.getByLabel(mobile ? 'Machine' : 'Settings machine', {
      exact: true,
    })
    await projects.waitFor()
    assert.equal(await environments.locator('option').first().textContent(), 'All machines')
    assert.equal(await projects.locator('option').first().textContent(), 'All projects')
    assert.equal(await page.getByRole('button', { name: /Edit .* settings/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Change scope', exact: true }).count(), 0)
    assert.equal(await page.getByLabel('Settings scope', { exact: true }).count(), 0)
    await projects.selectOption('git:github.com/team/repo')
    await environments.selectOption('linux')
    await page.getByText('Editing Shared project on Linux', { exact: true }).waitFor()
    await page.getByText('Saved on Linux', { exact: true }).waitFor()
    await page.getByLabel('Setup command', { exact: true }).fill('project setup')
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page
      .getByText(mobile ? /^Settings saved at / : 'Defaults saved for new tasks.', {
        exact: !mobile,
      })
      .waitFor()
    assert.deepEqual(
      await page.evaluate(() => ({
        host: window.writes.at(-1).host,
        scope: window.writes.at(-1).scope,
        repo: window.writes.at(-1).repositoryId,
      })),
      { host: 'linux', scope: 'environment-project', repo: 'linux-repo' },
    )
    await page.getByRole('button', { name: 'Tools page', exact: true }).click()
    assert.equal(await projects.inputValue(), 'git:github.com/team/repo')
    assert.equal(await environments.inputValue(), 'linux')
    assert.equal(await page.getByTestId('target').textContent(), 'environment-project:linux-repo')
    await environments.selectOption('empty')
    await page
      .getByText('This project is not available on the selected computer. Choose another target.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await page.getByTestId('target').count(), 0)
    await environments.selectOption('')
    assert.equal(await page.getByTestId('target').textContent(), 'project:mac-repo')
    await projects.selectOption('')
    assert.equal(await page.getByTestId('target').textContent(), 'global:')
    await page.getByRole('button', { name: 'Defaults page', exact: true }).click()
    await page
      .getByRole('button', { name: 'Use inherited worktree setup: No setup command', exact: true })
      .click()
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page
      .getByText(mobile ? /^Settings saved at / : 'Defaults saved for new tasks.', {
        exact: !mobile,
      })
      .waitFor()
    const last = await page.evaluate(() => window.writes.at(-1))
    assert.equal(last.scope, 'global')
    assert.equal(last.after.taskDefaults.setupCommand, undefined)
    // Later overrides stay visible from the shared defaults; opening one moves the shared target there.
    const overridden = page.getByRole('button', {
      name: mobile
        ? '1 override keeps its own value for worktree setup'
        : 'Worktree setup: overridden at 1 later level',
      exact: true,
    })
    await overridden.click()
    await page.getByText('Machine · Linux', { exact: true }).waitFor()
    await page.getByText('linux setup', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Open Machine settings for Linux', exact: true }).click()
    assert.equal(await environments.inputValue(), 'linux')
    assert.equal(await projects.inputValue(), '')
    await page.getByText('Editing Linux defaults', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Save defaults', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: /overridden at/ }).count(), 0)
    await environments.selectOption('')
    await overridden.click()
    await page
      .getByRole('button', { name: 'Reset all later worktree setup overrides', exact: true })
      .click()
    await page.getByText('Reset 1 override.', { exact: true }).waitFor()
    const reset = await page.evaluate(() => window.writes.at(-1))
    assert.equal(reset.host, 'linux')
    assert.equal(reset.scope, 'environment')
    assert.equal(reset.after.taskDefaults.setupCommand, undefined)
    // A sole computer needs no picker; shared defaults and overrides remain reachable.
    await page.getByRole('button', { name: 'Tools page', exact: true }).click()
    await page.evaluate(() => window.configureSources(1))
    await environments.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Edit computer overrides', exact: true }).click()
    await page.getByText('Editing Mac defaults', { exact: true }).waitFor()
    assert.equal(await page.getByTestId('target').textContent(), 'environment:')
    await projects.selectOption('git:github.com/team/repo')
    assert.equal(await page.getByTestId('target').textContent(), 'environment-project:mac-repo')
    await page.getByRole('button', { name: 'Edit shared defaults', exact: true }).click()
    assert.equal(await page.getByTestId('target').textContent(), 'project:mac-repo')
    await page.getByRole('button', { name: 'Edit computer overrides', exact: true }).click()
    await projects.selectOption('local:["mac","local-folder"]')
    assert.equal(await page.getByTestId('target').textContent(), 'environment-project:local-folder')
    await page.getByRole('button', { name: 'Edit shared defaults', exact: true }).click()
    assert.equal(await page.getByTestId('target').textContent(), 'global:')
    await page.evaluate(() => window.configureSources(2, true))
    await environments.waitFor()
    assert.equal(await environments.locator('option').last().textContent(), 'Linux · Offline')
    await page.evaluate(() => window.configureSources(0))
    await environments.waitFor({ state: 'detached' })
    await page
      .getByText('Connect a computer to configure defaults and project tools.', { exact: true })
      .waitFor()
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'}: persistent target across settings pages, canonical Git identity, exact host writes, missing-project protection and individual inheritance reset passed.`,
    )
  }
} finally {
  await browser.close()
}
