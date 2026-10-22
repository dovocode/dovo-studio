import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const state = `import {useState} from 'react';export const useApplicationState=useState;`
const controls = `import {useState,cloneElement,isValidElement,createContext,useContext} from 'react';export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)?cloneElement(children,{"aria-label":label}):children}</label>;export const ChoicePicker=({value,onValueChange,children,disabled,...props})=><select aria-label={props["aria-label"]} value={value} disabled={disabled} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const ModelSettings=()=>null;export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children,accessibilityRole})=><div role={accessibilityRole}>{children}</div>;export const Platform={OS:'ios'};export const Sheet=({children})=>children;export const useInsideSheet=()=>false;export const Icon=()=> <span aria-hidden='true'/>;export const StyleSheet={create:value=>value,hairlineWidth:1};export const useWindowDimensions=()=>({width:390,height:844,fontScale:1});export const SearchField=props=><input aria-label={props.label} value={props.value} onChange={e=>props.onChangeText?.(e.target.value)}/>;export const styles={};export const MobileThemeContext=createContext({styles,colors:{text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'},mode:'dark'});export const useTheme=()=>useContext(MobileThemeContext);export const colors={text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'};export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Alert={alert:(title,message,buttons)=>{if(!window.cancelAlert)buttons.at(-1).onPress?.()}};export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const Field=({label,value,onChangeText,multiline,editable,error})=><label>{label}{multiline?<textarea aria-label={label} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/>} {error&&<span role="alert">{error}</span>}</label>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const Switch=({value,onValueChange,disabled,accessibilityLabel})=><input aria-label={accessibilityLabel} type="checkbox" checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>;export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:async run=>{setBusy(true);setError('');try{await run()}catch(e){setError(String(e))}finally{setBusy(false)}}}}`
const mocks = {
  '@dovo/studio-core': `export const useWorkspace=()=>window.store;export const useSettingsDraft=()=>{};export const useOptionalSettingsTarget=()=>null;`,
  '@dovo/studio-core/state': state,
  '../state/application-state': state,
  '../connection/provider': `export const useRuntime=()=>window.store;export const RuntimeScope=({children})=>children;`,
  'react-native': controls,
  'expo-router': 'export const router={push:()=>{}};',
  'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const built = await build({
      stdin: {
        contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {TaskDefaultSettings} from '${root}/${mobile ? 'apps/mobile/src/runtime/preferences' : 'packages/studio-ui/src'}/task-default-settings.tsx';import {${mobile ? 'TaskLifecycleSettings' : 'TaskBehaviorSettings'} as Lifecycle} from '${root}/${mobile ? 'apps/mobile/src/runtime/preferences/task-lifecycle-settings.tsx' : 'packages/studio-ui/src/task-behavior-settings.tsx'}';${mobile ? `import {SettingsPage as Frame} from '${root}/apps/mobile/src/screens/settings-theme.tsx';` : 'const Frame=({children})=>children;'}import {defaultTaskHarness} from '@dovo/protocol';const repo={id:'project',name:'Project',path:'/repo',branch:'main',gitIdentity:'github.com/team/repo'};window.writes=[];window.scopes={global:{taskDefaults:{harness:defaultTaskHarness('claude'),setupCommand:'global setup'},resources:{mcpServers:[],skills:[]},prompts:[{id:'review',name:'review',text:'Shared review'}]},environment:{},project:{},'environment-project':{}};const request=async(path,input)=>{if(path==='/api/runtime/preferences/read')return {autoContinueAfterRestart:false,settleOnPullClose:false,autoArchiveDays:21};if(path.endsWith('/read')){if(input.scope==='project'&&window.delayProject)await new Promise(resolve=>window.releaseProject=resolve);return {value:structuredClone(window.scopes[input.scope]),inherited:input.scope==='global'?{}:structuredClone(window.scopes.global),projectKey:'project:github.com/team/repo'}}if(path.endsWith('/save')){if(window.failSave)throw new Error('Settings changed on another device. Reload before saving.');window.writes.push(input);window.scopes[input.scope]=structuredClone(input.after);return {value:input.after,inherited:input.scope==='global'?{}:structuredClone(window.scopes.global),projectKey:'project:github.com/team/repo'}}throw new Error(path)};const snapshot={defaults:{configured:true,harness:defaultTaskHarness('codex'),permission:'full-access',scopedSettings:{environment:{taskDefaults:{execution:'worktree'}},shared:[{key:'global',updatedAt:1,changeId:'one',value:window.scopes.global}]}},workspace:{repositories:[repo],agents:[]}};const runtimes=[{profile:{id:'local',name:'Mac',connection:{address:'http://local',token:'local'}},snapshot,connected:true},{profile:{id:'remote',name:'Linux',connection:{address:'http://remote',token:'remote'}},snapshot:{...snapshot,defaults:{...snapshot.defaults,scopedSettings:{...snapshot.defaults.scopedSettings,environment:{taskDefaults:{execution:'main'}}}}},connected:false}];window.store={connected:true,request,call:request,snapshot,runtimes,overviews:runtimes,activeRuntimeId:'local',activeId:'local'};function App(){const [,render]=useState(0);const [lifecycle,setLifecycle]=useState(false);window.openLifecycle=()=>{window.store.snapshot.taskBehaviorSupported=true;window.store.snapshot.threadBehaviorSupported=true;setLifecycle(true)};window.setConnection=connected=>{window.store.connected=connected;render(value=>value+1)};return <Frame>{lifecycle?<Lifecycle scope='global' repository={repo}/>:<TaskDefaultSettings repository={repo} ${mobile ? '' : 'inline'}/>}</Frame>};createRoot(document.getElementById('app')).render(<App/>);`,
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } })
    page.setDefaultTimeout(6000)
    let errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    if (mobile) {
      await page.getByRole('button', { name: 'Task defaults', exact: true }).click()
      await page.getByRole('button', { name: 'Show Advanced workspace setup', exact: true }).click()
    }
    const scopes = page.getByLabel('Settings scope', { exact: true })
    await scopes.waitFor()
    // The icon stays visible before opening details; the latest API value wins over stale snapshots.
    const inheritance = page.getByRole('button', {
      name: 'View inheritance for working directory',
      exact: true,
    })
    await inheritance.waitFor()
    assert.equal(await inheritance.innerText(), '')
    assert.equal(await page.getByText('At this level: Local checkout', { exact: true }).count(), 0)
    await inheritance.click()
    await page.getByText('At this level: Local checkout', { exact: true }).waitFor()
    await page.getByText('Inherited · source snapshot outdated', { exact: true }).waitFor()
    if (mobile) await page.getByRole('button', { name: 'Hide inheritance', exact: true }).click()
    else await page.keyboard.press('Escape')
    const choose = async (control, value, name) => {
      if (mobile) await control.selectOption(value)
      else {
        await control.click()
        await page.getByRole('option', { name, exact: true }).click()
      }
    }
    const scopeNames = {
      global: 'All machines & projects',
      environment: 'Machine',
      project: 'Project',
      'environment-project': 'Project on machine',
    }
    const chooseScope = (value) => choose(scopes, value, scopeNames[value])
    if (mobile) {
      assert.equal(await scopes.locator('option').count(), 4)
      assert.equal(await scopes.inputValue(), 'environment-project')
    } else {
      assert.equal(await scopes.textContent(), 'Project on machine')
      await scopes.click()
      assert.equal(await page.getByRole('option').count(), 4)
      await page.keyboard.press('Escape')
    }
    const origin = page.getByRole(mobile ? 'checkbox' : 'switch', {
      name: 'Start from origin',
      exact: true,
    })
    const originOn = async () =>
      mobile ? origin.isChecked() : (await origin.getAttribute('aria-checked')) === 'true'
    assert.equal(await originOn(), true)
    await page
      .getByRole('button', { name: 'View inheritance for working directory', exact: true })
      .click()
    await page.getByText('Mac · editing', { exact: true }).waitFor()
    await page.getByText('Linux · offline, saved snapshot', { exact: true }).waitFor()
    await page
      .getByText(mobile ? '✓ New worktree · Mac defaults · effective' : 'New worktree', {
        exact: true,
      })
      .last()
      .waitFor()
    if (!mobile) await page.keyboard.press('Escape')
    await choose(
      page.getByRole('combobox', { name: 'Working directory', exact: true }),
      'main',
      'Local checkout',
    )
    if (mobile) await page.getByText('At this level: Local checkout', { exact: true }).waitFor()
    if (mobile)
      await page
        .getByRole('button', {
          name: 'Use inherited working directory: Local checkout',
          exact: true,
        })
        .click()
    else {
      await page
        .getByRole('button', { name: 'View inheritance for working directory', exact: true })
        .click()
      await page
        .getByRole('button', { name: 'Use inherited value: Local checkout', exact: true })
        .click()
    }
    assert.equal(
      mobile
        ? await page.getByRole('combobox', { name: 'Working directory', exact: true }).inputValue()
        : await page
            .getByRole('combobox', { name: 'Working directory', exact: true })
            .textContent(),
      mobile ? 'inherit' : 'Inherit (Local checkout)',
    )
    if (mobile) await page.getByRole('button', { name: 'Hide inheritance', exact: true }).click()
    else await page.keyboard.press('Escape')
    await chooseScope('global')
    assert.equal(await originOn(), true)
    await origin.click()
    assert.equal(await originOn(), false)
    if (!mobile)
      await page.locator('summary[data-setting-label="Advanced workspace setup"]').click()
    await page.getByLabel('Setup command', { exact: true }).fill('global new setup')
    await page.getByLabel('Prompt text', { exact: true }).fill('Updated shared review')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page
      .getByText(mobile ? /^Settings saved at / : 'Changes saved.', {
        exact: !mobile,
      })
      .waitFor()
    let write = await page.evaluate(() => window.writes.at(-1))
    assert.equal(write.scope, 'global')
    assert.equal(write.after.taskDefaults.worktreeFromOrigin, false)
    assert.equal(write.after.taskDefaults.setupCommand, 'global new setup')
    assert.equal(write.after.prompts[0].text, 'Updated shared review')
    assert.deepEqual(write.after.resources, { mcpServers: [], skills: [] })
    await chooseScope('environment-project')
    await page.getByRole('button', { name: 'Override inherited #review', exact: true }).click()
    assert.equal(await originOn(), false)
    await page.getByLabel('Prompt text', { exact: true }).fill('Local override')
    if (!mobile) await page.getByText('More', { exact: true }).click()
    await page
      .getByRole('button', { name: 'Reset task defaults to inherited settings', exact: true })
      .click()
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page
      .getByText(mobile ? /^Settings saved at / : 'Changes saved.', {
        exact: !mobile,
      })
      .waitFor()
    write = await page.evaluate(() => window.writes.at(-1))
    assert.equal(write.scope, 'environment-project')
    assert.deepEqual(write.after.taskDefaults, {})
    assert.equal(await originOn(), false)
    assert.equal(write.after.prompts[0].text, 'Local override')
    assert.equal(write.repositoryId, 'project')
    await chooseScope('project')
    const computerLabel = mobile ? 'Default server' : 'Preferred computer'
    const defaultServer = page.getByRole('combobox', { name: computerLabel, exact: true })
    await defaultServer.waitFor()
    await page.waitForFunction(
      (label) => !document.querySelector(`[aria-label="${label}"]`).disabled,
      computerLabel,
    )
    await defaultServer.selectOption('remote')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page
      .getByText(mobile ? /^Settings saved at / : 'Changes saved.', {
        exact: !mobile,
      })
      .waitFor()
    write = await page.evaluate(() => window.writes.at(-1))
    assert.equal(write.scope, 'project')
    assert.equal(write.after.taskDefaults.defaultServerId, 'remote')
    assert.equal(write.projectKey, 'project:github.com/team/repo')
    await chooseScope('global')
    await chooseScope('project')
    await page.waitForFunction(
      (label) => document.querySelector(`[aria-label="${label}"]`)?.value === 'remote',
      computerLabel,
    )
    await defaultServer.selectOption('')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page
      .getByText(mobile ? /^Settings saved at / : 'Changes saved.', {
        exact: !mobile,
      })
      .waitFor()
    assert.equal(
      await page.evaluate(() => window.writes.at(-1).after.taskDefaults.defaultServerId),
      undefined,
    )
    await chooseScope('global')
    await page.evaluate(() => (window.delayProject = true))
    await chooseScope('project')
    await page.waitForFunction(() => !!window.releaseProject)
    assert.equal(
      await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(),
      true,
    )
    await chooseScope('global')
    await page.getByLabel('Setup command', { exact: true }).waitFor()
    await page.evaluate(() => window.releaseProject())
    assert.equal(
      mobile ? await scopes.inputValue() : await scopes.textContent(),
      mobile ? 'global' : 'All machines & projects',
    )
    assert.equal(
      await page.getByLabel('Setup command', { exact: true }).inputValue(),
      'global new setup',
    )
    assert.equal(await originOn(), false)
    // A reconnect must retain both the local draft and its original save baseline.
    await page.getByLabel('Setup command', { exact: true }).fill('keep my offline edits')
    const baseline = await page.evaluate(() => structuredClone(window.scopes.global))
    await page.evaluate(() => window.setConnection(false))
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Save changes' && button.disabled,
      ),
    )
    assert.equal(
      await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.scopes.global.taskDefaults.setupCommand = 'saved on another device'
      window.setConnection(true)
      window.failSave = true
    })
    assert.equal(
      await page.getByLabel('Setup command', { exact: true }).inputValue(),
      'keep my offline edits',
    )
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Settings changed on another device' })
      .waitFor()
    await page.getByText('Latest saved changes · your draft is kept', { exact: true }).waitFor()
    await page.getByText('global new setup → saved on another device', { exact: true }).waitFor()
    assert.equal(
      await page.getByLabel('Setup command', { exact: true }).inputValue(),
      'keep my offline edits',
    )
    if (mobile) {
      // RN's Alert choices are exercised through the native boundary fixture.
      await page.evaluate(() => (window.cancelAlert = true))
    } else page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('button', { name: 'Reload settings', exact: true }).click()
    assert.equal(
      await page.getByLabel('Setup command', { exact: true }).inputValue(),
      'keep my offline edits',
    )
    if (!mobile) page.once('dialog', (dialog) => dialog.accept())
    else await page.evaluate(() => (window.cancelAlert = false))
    await page.getByRole('button', { name: 'Reload settings', exact: true }).click()
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Setup command"]')?.value === 'saved on another device',
    )
    await page.evaluate(() => (window.failSave = false))
    await page.getByLabel('Setup command', { exact: true }).fill('saved after resolving conflict')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    assert.equal(
      (await page.evaluate(() => window.writes.at(-1))).before.taskDefaults.setupCommand,
      'saved on another device',
    )
    assert.equal(baseline.taskDefaults.setupCommand, 'global new setup')
    await page.evaluate(() => {
      window.delayProject = false
      window.openLifecycle()
    })
    const resume = page.getByRole('combobox', { name: 'Auto-resume limited tasks', exact: true })
    await resume.waitFor()
    await choose(resume, 'on', 'On')
    await page.evaluate(() => window.setConnection(false))
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Save changes' && button.disabled,
      ),
    )
    assert.equal(
      await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.scopes.global.taskBehavior = { quotaResume: false }
      window.failSave = true
      window.setConnection(true)
    })
    assert.equal(
      mobile ? await resume.inputValue() : await resume.textContent(),
      mobile ? 'on' : 'On',
    )
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page
      .getByRole('alert')
      .filter({ hasText: 'Settings changed on another device' })
      .waitFor()
    if (mobile) await page.evaluate(() => (window.cancelAlert = true))
    else page.once('dialog', (dialog) => dialog.dismiss())
    await page
      .getByRole('button', { name: mobile ? 'Reload settings' : 'Reload', exact: true })
      .click()
    assert.equal(
      mobile ? await resume.inputValue() : await resume.textContent(),
      mobile ? 'on' : 'On',
    )
    if (mobile) await page.evaluate(() => (window.cancelAlert = false))
    else page.once('dialog', (dialog) => dialog.accept())
    await page
      .getByRole('button', { name: mobile ? 'Reload settings' : 'Reload', exact: true })
      .click()
    await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor()
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Auto-resume limited tasks"]')
          ?.textContent?.includes('Off') ||
        document.querySelector('[aria-label="Auto-resume limited tasks"]')?.value === 'off',
    )
    assert.deepEqual(errors, [])
    await page.evaluate(() => (window.failSave = false))
    const days = page.getByRole('textbox', {
      name: 'Days of inactivity before settling',
      exact: true,
    })
    await days.fill('400')
    await page.getByText('Enter 1–365 days, or leave empty to inherit.', { exact: true }).waitFor()
    assert.equal(await days.inputValue(), '400')
    assert.equal(
      await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => window.setConnection(false))
    await page.evaluate(() => window.setConnection(true))
    assert.equal(await days.inputValue(), '400')
    await days.fill('5')
    assert.equal(
      await page.getByRole('button', { name: 'Save changes', exact: true }).isEnabled(),
      true,
    )
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.waitForFunction(() => window.writes.at(-1)?.after.taskBehavior?.inactiveDays === 5)
    assert.equal(
      (await page.evaluate(() => window.writes.at(-1))).after.taskBehavior.inactiveDays,
      5,
    )
    const archive = page.getByRole('combobox', { name: 'Auto-archive settled tasks', exact: true })
    if (!mobile) {
      await archive.click()
      await page
        .getByRole('option', {
          name: 'Inherit (Computer policy · 21 days of inactivity)',
          exact: true,
        })
        .waitFor()
      await page.keyboard.press('Escape')
    } else
      assert.equal(
        await archive.locator('option:checked').innerText(),
        'Inherit (Computer policy · 21 days of inactivity)',
      )
    console.log(
      (mobile ? 'Mobile' : 'Desktop') +
        ': four scope selection, shared prompt editing, preserved resources, local prompt overrides, resetting defaults, origin on by default, persistent origin opt-outs, stale read cancellation, offline drafts and explicit conflict reloads for defaults and lifecycle passed.',
    )
    await page.close()
  }
} finally {
  await browser.close()
}
