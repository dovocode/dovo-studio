import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const state = `export {useState as useApplicationState} from 'react';`
const controls = `import {cloneElement,isValidElement,useState,createContext,useContext} from 'react';export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)?cloneElement(children,{'aria-label':label}):children}</label>;export const ChoicePicker=({value,onValueChange,children,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const ModelSettings=()=>null;export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children})=><div>{children}</div>;export const Platform={OS:'ios'};export const Sheet=({children})=>children;export const useInsideSheet=()=>false;export const Icon=()=> <span aria-hidden='true'/>;export const StyleSheet={create:value=>value,hairlineWidth:1};export const useWindowDimensions=()=>({width:390,height:844,fontScale:1});export const SearchField=props=><input aria-label={props.label} value={props.value} onChange={e=>props.onChangeText?.(e.target.value)}/>;export const styles={};export const MobileThemeContext=createContext({styles,colors:{text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'},mode:'dark',palette:'dovo'});export const useTheme=()=>useContext(MobileThemeContext);export const colors={text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'};export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Alert={alert:(title,message,buttons)=>buttons.at(-1).onPress?.()};export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const Field=({label,value,onChangeText,multiline,editable})=><label>{label}{multiline?<textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>}</label>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const Switch=({value,onValueChange,disabled})=><input type="checkbox" checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>;export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:async run=>{setBusy(true);try{await run()}catch(e){setError(String(e))}finally{setBusy(false)}}}};`
const cssServer = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await cssServer.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await cssServer.close()
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const base = mobile
      ? root + '/apps/mobile/src/runtime/preferences'
      : root + '/packages/studio-core/src'
    const header = mobile ? 'ScopedSettings' : 'SettingsScopePage'
    const core = `export const useStudioHost=()=>({navigate:target=>window.navigations.push(target)});export {ConfirmationContext,useConfirmation} from '${root}/packages/studio-core/src/confirmation.tsx';import {createContext,useContext} from 'react';export {SettingsTargetProvider,useSettingsTarget,useOptionalSettingsTarget,useSettingsDraft} from '${root}/packages/studio-core/src/settings-target.tsx';const Scope=createContext(null);export const useWorkspace=()=>useContext(Scope)||window.runtime;export const WorkspaceScope=({profile,children})=>{const entry=window.sources.find(entry=>entry.profile.id===profile.id);return <Scope.Provider value={{...window.runtime,activeRuntimeId:profile.id,snapshot:entry.snapshot,connected:entry.connected,request:(path,input)=>window.request(profile.id,path,input)}}><div data-owner={profile.id}>{children}</div></Scope.Provider>};`
    const nativeRuntime = `import {createContext,useContext,useCallback} from 'react';const Scope=createContext(null);export const useRuntime=()=>useContext(Scope)||window.runtime;export const RuntimeScope=({runtimeId,children})=>{const call=useCallback((path,input)=>window.request(runtimeId,path,input),[runtimeId]);const entry=window.sources.find(entry=>entry.profile.id===runtimeId);return <Scope.Provider value={{...window.runtime,activeId:runtimeId,snapshot:entry.snapshot,connected:entry.connected,call}}><div data-owner={runtimeId}>{children}</div></Scope.Provider>};`
    const mocks = {
      '@dovo/studio-core': core,
      './workspace/context': `export {useWorkspace} from '@dovo/studio-core';`,
      './workspace/provider': `export const useWorkspace=()=>window.runtime;`,
      './workspace/runtime-sources': `export const useRuntimeSources=()=>window.sources;`,
      './runtime/application-state': state,
      '@dovo/studio-core/state': state,
      '../state/application-state': state,
      '../connection/provider': nativeRuntime,
      '../../runtime/connection/provider': nativeRuntime,
      'react-native': controls,
      'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
    }
    const built = await build({
      stdin: {
        contents: `import {StudioConfirmationProvider} from '${root}/packages/studio-ui/src/confirmation-provider.tsx';import {useState} from 'react';import {createRoot} from 'react-dom/client';import {SettingsTargetProvider${mobile ? ',ScopedSettings' : ''}} from '${base}/settings-target.tsx';${mobile ? '' : `import {SettingsScopePage} from '${root}/packages/studio-ui/src/settings-scope-page.tsx';`}import {TaskDefaultSettings} from '${mobile ? base : root + '/packages/studio-ui/src'}/task-default-settings.tsx';const repo={id:'mac-repo',name:'Shared project',path:'/mac/repo',branch:'main',gitIdentity:'github.com/team/repo'};window.sources=[{profile:{id:'mac',name:'Mac',connection:{address:'http://mac.local',token:'test-token'}},name:'Mac',scope:'mac',connected:true,snapshot:{scopedAgentsSupported:false,taskBehaviorSupported:false,defaults:{},workspace:{repositories:[repo,{id:'local-folder',name:'Local folder',path:'/mac/folder',kind:'folder'}]}}},{profile:{id:'linux',name:'Linux',connection:{address:'http://linux.local',token:'test-token'}},name:'Linux',scope:'linux',connected:true,snapshot:{scopedAgentsSupported:true,taskBehaviorSupported:true,defaults:{scopedSettings:{environment:{taskDefaults:{setupCommand:'linux setup'}},shared:[]}},workspace:{repositories:[{...repo,id:'linux-repo',path:'/linux/repo'}]}}},{profile:{id:'empty',name:'Empty',connection:{address:'http://empty.local',token:'test-token'}},name:'Empty',scope:'empty',connected:true,snapshot:{scopedAgentsSupported:false,taskBehaviorSupported:true,defaults:{},workspace:{repositories:[]}}}];window.writes=[];window.navigations=[];window.request=async(host,path,input)=>{if(path.endsWith('/read'))return {value:{taskDefaults:{setupCommand:'scope setup'}},inherited:{taskDefaults:{}},projectKey:'project:github.com/team/repo'};if(path.endsWith('/save')){window.writes.push({host,...input});return {value:input.after,inherited:{}}}throw Error(path)};window.runtime={runtimes:window.sources,overviews:window.sources,activeId:'mac',activeRuntimeId:'mac',snapshot:window.sources[0].snapshot,connected:true,readRuntime:(profile,path,input)=>window.request(profile.id,path,input)};const savedSources=window.sources;function App(){const [revision,setRevision]=useState(0);window.configureSources=(count,offline=false)=>{window.sources=savedSources.slice(0,count).map((entry,index)=>({...entry,connected:!(offline&&index===count-1)}));window.runtime={...window.runtime,runtimes:window.sources,overviews:window.sources};setRevision(value=>value+1)};const [page,setPage]=useState('defaults');return <SettingsTargetProvider><button onClick={()=>setPage('defaults')}>Defaults page</button><button onClick={()=>setPage('tools')}>Tools page</button><button onClick={()=>setPage('agents')}>Agents page</button><button onClick={()=>setPage('lifecycle')}>Lifecycle page</button><${header} ${mobile ? '' : 'title={page} description="Scoped settings" offlineRecovery={page==="defaults"} supportsEditing={page==="agents"?(snapshot=>snapshot?.scopedAgentsSupported===true):page==="lifecycle"?(snapshot=>snapshot?.taskBehaviorSupported===true):undefined} saveInfo={page==="agents"?"Use Save changes to apply profile edits.":page==="defaults"||page==="lifecycle"?"Use Save changes to apply edits.":"Tool changes use Save."}'}>{selection=>page==='defaults'?<TaskDefaultSettings inline scope={selection.scope} repository={selection.repository}/>:<p data-testid="target">{selection.scope}:{selection.repository?.id||''}</p>}</${header}></SettingsTargetProvider>}createRoot(document.getElementById('app')).render(<StudioConfirmationProvider><App/></StudioConfirmationProvider>);`,
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
              if (!mobile && /choice-picker$/.test(path)) return
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
    const assertTarget = async (expected) => {
      await page.waitForFunction(
        (value) => document.querySelector('[data-testid="target"]')?.textContent === value,
        expected,
      )
      assert.equal(await page.getByTestId('target').textContent(), expected)
    }
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    if (!mobile) await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    page.on('dialog', (dialog) => dialog.accept())
    if (mobile) await page.getByText('All projects on all computers', { exact: true }).waitFor()
    else {
      await page.getByText('Scope', { exact: true }).waitFor()
      await page.getByText('Shared defaults', { exact: true }).waitFor()
      await page.getByText('Editing all projects on all computers', { exact: true }).waitFor()
      assert.equal(await page.getByText('Applies to', { exact: true }).count(), 0)
      assert.equal(
        await page.getByText('Use Save changes to apply edits.', { exact: true }).count(),
        1,
        'Thread defaults remain editable with explicit saves on legacy sources',
      )
    }
    if (!mobile) await page.getByRole('button', { name: 'Settings inheritance details' }).click()
    if (!mobile) await page.getByText('Shared across paired computers', { exact: true }).waitFor()
    if (!mobile) await page.keyboard.press('Escape')
    const projects = mobile
      ? page.getByLabel('Project', { exact: true })
      : page.getByRole('button', { name: 'Settings project', exact: true })
    const environments = mobile
      ? page.getByLabel('Computer', { exact: true })
      : page.getByRole('button', { name: 'Settings computer', exact: true })
    const select = async (picker, value) => {
      if (mobile) return picker.selectOption(value)
      await picker.click()
      await page.locator(`[role="option"][data-value='${value}']`).click()
    }
    const value = (picker) => (mobile ? picker.inputValue() : picker.getAttribute('data-value'))
    await projects.waitFor()
    if (mobile) {
      assert.equal(await environments.locator('option').first().textContent(), 'All computers')
      assert.equal(await projects.locator('option').first().textContent(), 'All projects')
    } else {
      assert.equal(await environments.innerText(), 'All computers')
      assert.equal(await projects.innerText(), 'All projects')
    }
    assert.equal(await page.getByRole('button', { name: /Edit .* settings/ }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Change scope', exact: true }).count(), 0)
    assert.equal(await page.getByLabel('Settings scope', { exact: true }).count(), 0)
    if (!mobile) {
      const saveHint = page.getByText('Use Save changes to apply edits.', { exact: true })
      const profileSaveHint = page.getByText('Use Save changes to apply profile edits.', {
        exact: true,
      })
      await page.getByRole('button', { name: 'Agents page', exact: true }).click()
      await page.getByText('Viewing all projects on all computers', { exact: true }).waitFor()
      assert.equal(await profileSaveHint.count(), 0)
      assert.equal(await environments.isEnabled(), true)
      assert.equal(await projects.isEnabled(), true)
      await page.getByRole('button', { name: 'Settings inheritance details' }).click()
      await page.getByText('Viewing All projects on all computers', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await select(environments, 'linux')
      await page.getByText('Editing all projects on Linux', { exact: true }).waitFor()
      await profileSaveHint.waitFor()
      assert.equal(await page.evaluate(() => window.runtime.snapshot.scopedAgentsSupported), false)
      await page.getByRole('button', { name: 'Lifecycle page', exact: true }).click()
      await saveHint.waitFor()
      await select(environments, 'mac')
      await page.getByText('Viewing all projects on Mac', { exact: true }).waitFor()
      assert.equal(await saveHint.count(), 0)
      await select(environments, 'empty')
      await page.getByText('Editing all projects on Empty', { exact: true }).waitFor()
      await saveHint.waitFor()
      await page.getByRole('button', { name: 'Agents page', exact: true }).click()
      await page.getByText('Viewing all projects on Empty', { exact: true }).waitFor()
      assert.equal(await profileSaveHint.count(), 0, 'Each page uses its own runtime capability')
      await select(environments, '')
      await page.getByRole('button', { name: 'Defaults page', exact: true }).click()
      await page.getByText('Editing all projects on all computers', { exact: true }).waitFor()
      await saveHint.waitFor()
      assert.equal(await page.evaluate(() => window.writes.length), 0)
    }
    await select(projects, 'git:github.com/team/repo')
    await select(environments, 'linux')
    if (mobile) await page.getByText('Shared project on Linux', { exact: true }).waitFor()
    else {
      assert.equal(await value(projects), 'git:github.com/team/repo')
      assert.equal(await value(environments), 'linux')
      await page.getByText('Editing Shared project on Linux', { exact: true }).waitFor()
      await page.getByText('Project overrides', { exact: true }).waitFor()
      await page.getByText('Use Save changes to apply edits.', { exact: true }).waitFor()
      assert.equal(
        await page.evaluate(() => window.runtime.snapshot.scopedAgentsSupported),
        false,
        'The cue uses the selected Linux snapshot while the active runtime remains legacy Mac',
      )
    }
    if (!mobile) await page.getByRole('button', { name: 'Settings inheritance details' }).click()
    if (!mobile) await page.getByText('Saved on Linux', { exact: true }).waitFor()
    if (!mobile) {
      await page.keyboard.press('Escape')
      await page.locator('summary[data-setting-label="Advanced workspace setup"]').click()
    } else
      await page.getByRole('button', { name: 'Show Advanced workspace setup', exact: true }).click()
    await page.getByLabel('Setup command', { exact: true }).fill('project setup')
    if (!mobile) {
      await select(environments, 'mac')
      const discard = page.getByRole('dialog', {
        name: 'Discard unsaved settings changes?',
        exact: true,
      })
      await discard.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.equal(await value(environments), 'linux')
      assert.equal(
        await page.getByLabel('Setup command', { exact: true }).inputValue(),
        'project setup',
      )
      assert.equal(await page.evaluate(() => window.writes.length), 0)
      await select(environments, 'mac')
      await discard.getByRole('button', { name: 'Discard changes', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('[aria-label="Settings computer"]')?.dataset.value === 'mac',
      )
      await select(environments, 'linux')
      await page.locator('summary[data-setting-label="Advanced workspace setup"]').click()
      await page.getByLabel('Setup command', { exact: true }).fill('project setup')
      const savebar = await page
        .getByRole('group', { name: 'Settings save actions' })
        .evaluate((node) => {
          const style = getComputedStyle(node)
          return {
            radius: style.borderRadius,
            shadow: style.boxShadow,
            bottom: style.bottom,
            background: style.backgroundColor,
            topBorder: style.borderTopWidth,
            sideBorder: style.borderLeftWidth,
          }
        })
      assert.equal(savebar.radius, '0px')
      assert.equal(savebar.shadow, 'none')
      assert.equal(savebar.bottom, '0px')
      assert.equal(savebar.topBorder, '1px')
      assert.equal(savebar.sideBorder, '0px')
      assert.notEqual(savebar.background, 'rgba(0, 0, 0, 0)')
    }
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page
      .getByText(mobile ? /^Settings saved at / : 'Changes saved.', {
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
    assert.equal(await value(projects), 'git:github.com/team/repo')
    assert.equal(await value(environments), 'linux')
    await assertTarget('environment-project:linux-repo')
    if (!mobile) await page.getByText('Tool changes use Save.', { exact: true }).waitFor()
    await select(environments, 'empty')
    await page
      .getByText('This project is not available on the selected computer. Choose another target.', {
        exact: true,
      })
      .waitFor()
    if (!mobile) await page.getByText('Viewing Shared project on Empty', { exact: true }).waitFor()
    assert.equal(await page.getByTestId('target').count(), 0)
    if (!mobile)
      assert.equal(await page.getByText('Tool changes use Save.', { exact: true }).count(), 0)
    await select(environments, '')
    await assertTarget('project:mac-repo')
    await select(projects, '')
    await assertTarget('global:')
    await page.getByRole('button', { name: 'Defaults page', exact: true }).click()
    if (!mobile)
      await page.locator('summary[data-setting-label="Advanced workspace setup"]').click()
    else
      await page.getByRole('button', { name: 'Show Advanced workspace setup', exact: true }).click()
    await page
      .getByRole('button', { name: 'Use inherited worktree setup: No setup command', exact: true })
      .click()
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page
      .getByText(mobile ? /^Settings saved at / : 'Changes saved.', {
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
    await page.getByText('Computer · Linux', { exact: true }).waitFor()
    await page.getByText('linux setup', { exact: true }).waitFor()
    await page
      .getByRole('button', { name: 'Open Computer settings for Linux', exact: true })
      .click()
    assert.equal(await value(environments), 'linux')
    assert.equal(await value(projects), '')
    if (mobile) await page.getByText('Linux defaults', { exact: true }).waitFor()
    else assert.equal(await value(environments), 'linux')
    if (mobile) await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor()
    else
      assert.equal(await page.getByRole('button', { name: 'Save changes', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: /overridden at/ }).count(), 0)
    await select(environments, '')
    if (!mobile)
      await page.locator('summary[data-setting-label="Advanced workspace setup"]').click()
    else
      await page.getByRole('button', { name: 'Show Advanced workspace setup', exact: true }).click()
    await overridden.click()
    await page
      .getByRole('button', { name: 'Reset all later worktree setup overrides', exact: true })
      .click()
    if (!mobile)
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Reset overrides', exact: true })
        .click()
    await page.getByText('Reset 1 override.', { exact: true }).waitFor()
    const reset = await page.evaluate(() => window.writes.at(-1))
    assert.equal(reset.host, 'linux')
    assert.equal(reset.scope, 'environment')
    assert.equal(reset.after.taskDefaults.setupCommand, undefined)
    // Desktop uses the same picker for one or many computers; mobile keeps its shortcut.
    await page.getByRole('button', { name: 'Tools page', exact: true }).click()
    await page.evaluate(() => window.configureSources(1))
    if (mobile) {
      await environments.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Edit computer overrides', exact: true }).click()
    } else {
      await environments.waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: /Edit (computer overrides|shared defaults)/ })
          .count(),
        0,
      )
      await select(environments, 'mac')
    }
    if (mobile) await page.getByText('Mac defaults', { exact: true }).waitFor()
    else {
      assert.equal(await environments.innerText(), 'Mac')
      await page.getByText('Computer overrides', { exact: true }).waitFor()
    }
    await assertTarget('environment:')
    await select(projects, 'git:github.com/team/repo')
    await assertTarget('environment-project:mac-repo')
    if (mobile)
      await page.getByRole('button', { name: 'Edit shared defaults', exact: true }).click()
    else await select(environments, '')
    await assertTarget('project:mac-repo')
    if (mobile)
      await page.getByRole('button', { name: 'Edit computer overrides', exact: true }).click()
    else await select(environments, 'mac')
    await select(projects, 'local:["mac","local-folder"]')
    await assertTarget('environment-project:local-folder')
    if (mobile)
      await page.getByRole('button', { name: 'Edit shared defaults', exact: true }).click()
    else await select(environments, '')
    if (!mobile) {
      await page
        .getByText(
          'This project is not available on the selected computer. Choose another target.',
          { exact: true },
        )
        .waitFor()
      assert.equal(await value(projects), 'local:["mac","local-folder"]')
      await select(projects, '')
    }
    await assertTarget('global:')
    await page.evaluate(() => window.configureSources(2, true))
    await environments.waitFor()
    if (mobile)
      assert.equal(await environments.locator('option').last().textContent(), 'Linux · Offline')
    else {
      await environments.click()
      await page.getByRole('option', { name: 'Linux · Offline', exact: true }).click()
      await page
        .getByText('Linux is offline. Reconnect to edit or save.', { exact: true })
        .waitFor()
      await page.getByRole('status').filter({ hasText: 'Reconnect to edit or save.' }).waitFor()
      assert.equal(
        await page
          .getByRole('status')
          .filter({ hasText: /offline/i })
          .count(),
        1,
        'One persistent offline cue',
      )
      assert.equal(await page.getByText('Tool changes use Save.', { exact: true }).count(), 0)
      await page.getByText('Viewing all projects on Linux', { exact: true }).waitFor()
      assert.equal(
        await page.getByRole('button', { name: 'Open Devices & runtime', exact: true }).count(),
        0,
        'Pages with their own recovery do not receive a duplicate action',
      )
      await page.getByRole('button', { name: 'Defaults page', exact: true }).click()
      assert.equal(
        await page.getByText('Use Save changes to apply edits.', { exact: true }).count(),
        0,
        'Offline supported sources also hide manual-save cues',
      )
      const writesBeforeRecovery = await page.evaluate(() => window.writes.length)
      await page.getByRole('button', { name: 'Open Devices & runtime', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.navigations), [{ viewId: 'runtime' }])
      assert.equal(await page.evaluate(() => window.writes.length), writesBeforeRecovery)
      assert.equal(await environments.isEnabled(), true)
      assert.equal(await projects.isEnabled(), true)
      await page.getByRole('button', { name: 'Tools page', exact: true }).click()
      await select(environments, '')
      await page.evaluate(() => window.configureSources(1, true))
      await environments.click()
      await page.getByRole('option', { name: 'Mac · Offline', exact: true }).click()
      await page.getByText('Mac is offline. Reconnect to edit or save.', { exact: true }).waitFor()
      await page.getByRole('status').filter({ hasText: 'Reconnect to edit or save.' }).waitFor()
      assert.equal(
        await page
          .getByRole('status')
          .filter({ hasText: /offline/i })
          .count(),
        1,
      )
      assert.equal(await page.getByText('Tool changes use Save.', { exact: true }).count(), 0)
      await select(environments, '')
    }
    await page.evaluate(() => window.configureSources(0))
    await environments.waitFor({ state: 'detached' })
    await page
      .getByText('Connect a computer to configure defaults and project tools.', { exact: true })
      .waitFor()
    if (!mobile) {
      assert.equal(await page.getByText('Tool changes use Save.', { exact: true }).count(), 0)
      await page.getByText('Viewing all projects on all computers', { exact: true }).waitFor()
      for (const hasTouch of [false, true]) {
        const layoutPage = await browser.newPage({ hasTouch })
        layoutPage.on('pageerror', (error) => errors.push(error.message))
        await layoutPage.setContent('<div id="app"></div>')
        await layoutPage.addStyleTag({ content: css })
        await layoutPage.addScriptTag({ content: built.outputFiles[0].text })
        await layoutPage.getByRole('button', { name: 'Tools page', exact: true }).click()
        await layoutPage.evaluate(() => window.configureSources(1))
        for (const width of [320, 390, 976]) {
          await layoutPage.setViewportSize({ width, height: 700 })
          const target = layoutPage.getByLabel('Settings target', { exact: true })
          const fields = target.locator('.studio-settings-target-field')
          assert.equal(await fields.count(), 3)
          const heights = await fields.evaluateAll((elements) =>
            elements.map((element) => element.lastElementChild.getBoundingClientRect().height),
          )
          assert.deepEqual(heights, [hasTouch ? 44 : 36, hasTouch ? 44 : 36, hasTouch ? 44 : 36])
          assert.equal(
            await target.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
            true,
          )
          if (width === 976) {
            const labels = await target
              .locator('.studio-settings-target-label')
              .evaluateAll((elements) =>
                elements.map((element) => element.getBoundingClientRect().y),
              )
            assert.equal(
              Math.max(...labels) - Math.min(...labels),
              0,
              'Scope, Project and Computer labels align',
            )
          }
        }
        // Container queries also support a narrow pane inside a wide window.
        await layoutPage.evaluate(() => {
          document.getElementById('app').style.width = '320px'
        })
        assert.equal(
          await layoutPage
            .getByLabel('Settings target', { exact: true })
            .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          true,
        )
        await layoutPage.evaluate(() => {
          const app = document.getElementById('app')
          app.style.height = '100vh'
          app.style.display = 'flex'
          app.style.flexDirection = 'column'
          const spacer = document.createElement('div')
          spacer.style.height = '2000px'
          document.querySelector('.studio-settings-content').append(spacer)
        })
        const scrollport = layoutPage.getByRole('region', { name: 'tools settings', exact: true })
        const toolbar = layoutPage.locator('.studio-settings-toolbar')
        for (const position of ['top', 'middle', 'bottom']) {
          await scrollport.evaluate((node, position) => {
            node.scrollTop =
              position === 'top' ? 0 : position === 'middle' ? 500 : node.scrollHeight
          }, position)
          const geometry = await toolbar.evaluate((node) => {
            const scrollport = node.closest('.studio-settings-scroll')
            return {
              top: node.getBoundingClientRect().top,
              viewportTop: scrollport.getBoundingClientRect().top,
              viewportBottom: scrollport.getBoundingClientRect().bottom,
              bottom: node.getBoundingClientRect().bottom,
              scrollTop: scrollport.scrollTop,
            }
          })
          assert.ok(geometry.top >= geometry.viewportTop - 1, 'Sticky target stays fully visible')
          assert.ok(
            geometry.bottom <= geometry.viewportBottom + 1,
            'Wrapped target fits the scrollport',
          )
          if (position !== 'top') {
            assert.ok(geometry.scrollTop > 0, 'Fixture scrolls within Settings')
            assert.ok(
              Math.abs(geometry.top - geometry.viewportTop) <= 1,
              `Target sticks at scrollport top: ${JSON.stringify({ hasTouch, position, ...geometry })}`,
            )
          }
        }
        const computer = layoutPage.getByRole('button', { name: 'Settings computer', exact: true })
        await computer.focus()
        await computer.press('Enter')
        await layoutPage.getByRole('option', { name: 'Mac', exact: true }).waitFor()
        await layoutPage.keyboard.press('Escape')
        assert.equal(await computer.evaluate((node) => node === document.activeElement), true)
        await layoutPage.close()
      }
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'}: persistent target across settings pages, canonical Git identity, exact host writes, missing-project protection and individual inheritance reset passed.`,
    )
  }
} finally {
  await browser.close()
}
