import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const controls = `import {Effect} from 'effect';import {cloneElement,isValidElement,useState,createContext,useContext} from 'react';export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)&&children.type!=='div'?cloneElement(children,{'aria-label':label}):children}</label>;export const ChoicePicker=({value,onValueChange,children,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const ModelSettings=()=>null;const flat=style=>Array.isArray(style)?Object.assign({},...style.map(flat)):style??{};export const View=({children,style,accessibilityLabel,accessibilityState})=><div aria-label={accessibilityLabel} aria-busy={accessibilityState?.busy} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;export const ScrollView=View;export const Text=({children,style,accessibilityRole,accessibilityElementsHidden})=>{const value=flat(style);return <span role={accessibilityRole} aria-hidden={accessibilityElementsHidden} style={{display:'block',whiteSpace:'pre-line',...value,fontSize:(value.fontSize??13)*(window.fontScale??1),lineHeight:((value.lineHeight??18)*(window.fontScale??1))+'px'}}>{children}</span>};export const Platform={OS:'ios'};export const StyleSheet={create:value=>value,hairlineWidth:1};export const useWindowDimensions=()=>({width:390,height:844,fontScale:1});export const SearchField=props=><input aria-label={props.label} value={props.value} onChange={e=>props.onChangeText?.(e.target.value)}/>;export const styles={row:{},muted:{fontSize:13,lineHeight:18},error:{fontSize:13,lineHeight:18}};export const MobileThemeContext=createContext({styles,colors:{text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333',background:'#161616',action:'#ececec',onAccent:'#161616',selection:'#303030',error:'#f87171',onError:'#161616'},mode:'dark',palette:'dovo'});export const useTheme=()=>useContext(MobileThemeContext);export const colors={text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333',background:'#161616',action:'#ececec',onAccent:'#161616',selection:'#303030',error:'#f87171',onError:'#161616'};export const Pressable=({children,onPress,disabled,accessibilityLabel,style})=>{const value=flat(typeof style==='function'?style({pressed:false}):style);const {paddingHorizontal,paddingVertical,...rest}=value;return <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} style={{display:'flex',flexDirection:'column',boxSizing:'border-box',border:'0 solid',font:'inherit',padding:0,paddingLeft:paddingHorizontal,paddingRight:paddingHorizontal,paddingTop:paddingVertical,paddingBottom:paddingVertical,...rest}}>{children}</button>};export const IconButton=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const Field=({label,value,onChangeText,multiline,editable})=><label>{label}{multiline?<textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/>}</label>;export const SettingsChoice=Choice;export const SettingsField=Field;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:async run=>{setBusy(true);try{const result=run();await (Effect.isEffect(result)?Effect.runPromise(result):result)}catch(e){setError(String(e))}finally{setBusy(false)}}}};export const Dialog=({children})=><div role="dialog">{children}</div>;export const DialogContent=View;export const DialogDescription=Text;export const DialogHeader=View;export const DialogTitle=Text;export const useInsideSheet=()=>false;export const Sheet=({children,title})=><div role="dialog">{title}{children}</div>;export const AgentAvatar=()=>null;export const agentIconChoices={};export const PageHeader=({title})=><h1>{title}</h1>;export const ScreenHeader=PageHeader;export const TaskDefaultSettings=()=> <p>Default agent settings</p>;export const HarnessLabel=({agent})=><span>{agent.provider}</span>;export const ModelLabel=({agent})=><span>{agent.model}</span>;`

const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await server.close()
}

async function checkPendingRetest(page, scope) {
  const button = scope.getByRole('button', { name: 'Test connection', exact: true })
  const identity = scope.getByText(/@runtime-user · github.com/)
  const node = await identity.elementHandle()
  const buttonNode = await button.elementHandle()
  const before = await button.boundingBox()
  await page.evaluate(() => {
    window.holdConnectionCheck = true
  })
  await button.click()
  await page.waitForFunction(() => !!window.finishConnectionCheck)
  await page.waitForFunction((element) => element.disabled, buttonNode)
  assert.equal(await button.isDisabled(), true)
  assert.equal(await button.textContent(), 'Test connection')
  assert.equal(await node.evaluate((element) => element.isConnected), true)
  assert.equal(await buttonNode.evaluate((element) => element.isConnected), true)
  assert.equal(await identity.isVisible(), true)
  assert.match(await scope.textContent(), /Checked /)
  assert.match(await scope.ariaSnapshot(), /Checking GitHub connection…/)
  const during = await button.boundingBox()
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(before[key] - during[key]) < 1, `Retesting moved the button's ${key}`)
  }
  await page.evaluate(() => {
    window.holdConnectionCheck = false
    window.finishConnectionCheck()
    window.finishConnectionCheck = undefined
  })
  await button.waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
  const after = await button.boundingBox()
  assert.ok(Math.abs(before.y - after.y) < 1, 'Completing a retest moved the button')
}

const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const shared = `export * from '@dovo/protocol';export {cliProfileOptions} from '${root}/packages/client-runtime/src/extensions/cli-profile-options.ts';export {clientScopeKey} from '${root}/packages/client-runtime/src/effects/request-scope.ts';import {Effect} from 'effect';export {clientTaskScope} from '${root}/packages/client-runtime/src/index.ts';export const runClientEffect=Effect.runPromise;export const useWorkspace=()=>window.runtime;`
    const native = `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=><div>{children}</div>;`
    const mocks = {
      '../../screens/remote-desktop': 'export const MobileRemoteDesktop=()=>null;',
      'expo-router': `export const router={push:()=>{}};`,
      '../preferences/settings-target': `export const useSettingsDraft=()=>{};`,
      '@dovo/studio-core': shared,
      '@dovo/client-runtime': shared,
      '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
      '../state/application-state': `export {useState as useApplicationState} from 'react';`,
      '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
      '../../runtime/connection/provider': native,
      '../../screens/settings-controls': controls,
      '@dovo/studio-ui': `export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/button.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/input.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/textarea.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/dialog.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/ui/select.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/components/form-field.tsx';export * from '${new URL('../packages/', import.meta.url).pathname}studio-ui/src/choice-picker.tsx'`,
      'react-native': controls,
      './directory-picker': `export const DirectoryPicker=()=>null;`,
      '../../screens/settings-group': `export const SettingsSwitchRow=({label,value,onValueChange,disabled})=><button role="switch" aria-label={label} aria-checked={value} disabled={disabled} onClick={()=>onValueChange(!value)}>{label}</button>;export const SettingsGroup=({children})=><div>{children}</div>;export const SettingsRow=({title,onPress})=><button onClick={onPress}>{title}</button>;`,
    }
    const built = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {decode,runtimePreferencesSchema,forgeConnectionSchema,forgeConnectionInputSchema,RuntimeRequestError} from '@dovo/protocol';import ${mobile ? 'Connections' : '{ForgeConnections as Connections}'} from '${root}/${mobile ? 'apps/mobile/src/scm/connections/connections' : 'packages/extension-scm/src/connections/forge-connections'}.tsx';${mobile ? `import {RuntimePreferences} from '${root}/apps/mobile/src/runtime/connection/runtime-preferences.tsx';` : ''}import {GithubConnectionStatus} from '${root}/${mobile ? 'apps/mobile/src/scm/connections' : 'packages/extension-scm/src/connections'}/github-connection-status.tsx';let id=0;crypto.randomUUID=()=> '00000000-0000-4000-8000-'+String(++id).padStart(12,'0');window.preferences=decode(runtimePreferencesSchema,{});window.saved=[];window.connectionChecks=[];window.checkFailure=false;const request=async(path,input)=>{if(path==='/api/runtime/preferences/read')return window.preferences;if(path==='/api/runtime/preferences/save'){Object.assign(window.preferences,input);return {...window.preferences}};if(path==='/api/memory/projects/read')return {projects:[]};if(path.endsWith('connections/github/read')){if(window.diagnosticsUnavailable)throw new RuntimeRequestError({kind:'response',status:404,message:'Not found'});window.connectionChecks.push(input);if(window.holdConnectionCheck)await new Promise(resolve=>window.finishConnectionCheck=resolve);return {status:window.checkFailure?'failed':'verified',stage:input.repositoryId?'repository':'account',host:'github.com',login:input.repositoryId?'project-user':input.connectionId==='other-account'?'other-user':'runtime-user',repository:input.repositoryId?'team/app':undefined,checkedAt:'2026-10-16T18:00:00Z',message:window.checkFailure?'GitHub rejected this token. Check its expiry.':input.repositoryId?'Account verified · Repository readable.':'Account verified.'}};if(path.endsWith('cli-profiles/read'))return {profiles:[{id:'personal',name:'personal',active:true},{id:'work',name:'work'}]};if(path.endsWith('connections/read'))return {connections:window.saved};if(path.endsWith('connections/save')){window.connectionSaves??=[];window.connectionSaves.push(input);if(window.holdConnectionSave)await new Promise((resolve,reject)=>window.finishConnectionSave={resolve,reject});const value=decode(forgeConnectionInputSchema,input);const previous=window.saved.find(item=>item.id===value.id);const result=decode(forgeConnectionSchema,{...value,secretProvider:value.secret?.provider??(value.credential==='reference'?previous?.secretProvider:undefined),id:value.id??crypto.randomUUID(),revision:crypto.randomUUID()});window.saved=[...window.saved.filter(item=>item.id!==result.id),result];return result};throw Error(path)};const source={profile:{id:'host',name:'Host',connection:{address:'http://host.local',token:'fixture'}},name:'Host',connected:true};window.runtime={connection:source.profile.connection,workspace:{repositories:[{id:'automatic',name:'Automatic project',path:'/checkout',branch:'main'},{id:'folder',name:'Plain folder',path:'/folder',kind:'folder',branch:'main'}]},snapshot:{workspace:{repositories:[{id:'automatic',name:'Automatic project',path:'/checkout',branch:'main'},{id:'folder',name:'Plain folder',path:'/folder',kind:'folder',branch:'main'}]}},overviews:[source],connected:true,request,read:request,callEffect:(path,input)=>Effect.tryPromise({try:()=>request(path,input),catch:error=>error}),readEffect:(path,input)=>Effect.tryPromise({try:()=>request(path,input),catch:error=>error})};const root=createRoot(document.getElementById('app'));window.render=()=>root.render(<Connections/>);window.render();window.renderStatus=connectionId=>root.render(<section aria-label="Focused account diagnostics"><GithubConnectionStatus connectionId={connectionId}/></section>);${mobile ? 'window.renderPreferences=()=>root.render(<RuntimePreferences/>);' : ''}`,
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
            b.onResolve({ filter: /.*/ }, ({ path, importer }) =>
              importer.endsWith('/ui/controls/action.tsx') &&
              ['../theme', '../content/text', './icon-button'].includes(path)
                ? { path: 'native-controls', namespace: 'mock' }
                : path === './provider' &&
                    importer.endsWith('/runtime/connection/runtime-preferences.tsx')
                  ? { path: '../../runtime/connection/provider', namespace: 'mock' }
                  : Object.hasOwn(mocks, path)
                    ? { path, namespace: 'mock' }
                    : path.includes('/ui/') &&
                        mobile &&
                        !path.endsWith('/validation-fields') &&
                        !path.endsWith('/ui/controls/action') &&
                        !path.endsWith('/ui/controls/action.tsx') &&
                        !path.endsWith('/layout/content-column')
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
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    if (!mobile) await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    if (mobile) {
      await page.getByText(/@runtime-user · github.com/).waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: 'Test connection', exact: true })
          .evaluate((node) => getComputedStyle(node).borderTopWidth),
        '1px',
      )
      await checkPendingRetest(
        page,
        page.getByLabel('GitHub connection status', { exact: true }).first(),
      )
      await page.getByText(/Projects using automatic detection \(1\)/).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Plain folder', exact: true }).count(), 0)
      assert.equal(
        await page.evaluate(() => window.connectionChecks.some((input) => input.repositoryId)),
        false,
      )
      await page.getByRole('button', { name: 'Test project connection', exact: true }).click()
      await page.getByText(/@project-user · github.com/).waitFor()
      assert.deepEqual(await page.evaluate(() => window.connectionChecks.at(-1)), {
        connectionId: undefined,
        repositoryId: 'automatic',
        refresh: true,
      })
      await page.evaluate(() => {
        window.checkFailure = true
      })
      await page.getByRole('button', { name: 'Test connection', exact: true }).click()
      await page.getByText(/GitHub rejected this token/).waitFor()
      await page.getByText(/Last successful check/).waitFor()
      await page.evaluate(() => {
        window.checkFailure = false
        window.diagnosticsUnavailable = true
      })
      await page.getByRole('button', { name: 'Test connection', exact: true }).click()
      await page.getByText(/Connection diagnostics are unavailable/).waitFor()
      assert.equal(await page.getByText(/@runtime-user · github.com/).isVisible(), true)
      assert.equal(await page.getByText(/Last successful check/).isVisible(), true)
      await page.evaluate(() => {
        window.diagnosticsUnavailable = false
        window.runtime.connected = false
        window.render()
      })
      await page
        .getByText(/Computer offline · Reconnect/)
        .first()
        .waitFor()
      assert.equal(
        await page.getByRole('button', { name: 'Test connection', exact: true }).isDisabled(),
        true,
      )
      await page.evaluate(() => {
        window.runtime.connected = true
        window.render()
      })
      await page.getByText(/@runtime-user · github.com/).waitFor()
      console.log(
        'Mobile connection checks: contextual identity, explicit project access, failures, legacy runtime and offline states passed',
      )
    }
    if (!mobile) {
      const automatic = page.getByRole('article', {
        name: 'Automatic GitHub CLI connection',
        exact: true,
      })
      await automatic.getByText('@runtime-user · github.com').waitFor()
      await checkPendingRetest(
        page,
        automatic.getByLabel('GitHub connection status', { exact: true }).first(),
      )
      assert.equal(await automatic.getByText('Projects using automatic detection (1)').count(), 1)
      assert.equal(await automatic.getByText('Plain folder', { exact: true }).count(), 0)
      assert.equal(
        await page.evaluate(() => window.connectionChecks.some((input) => input.repositoryId)),
        false,
      )
      const project = page.getByLabel('Automatic connection for Automatic project', { exact: true })
      await project.getByRole('button', { name: 'Test project connection' }).click()
      await project.getByText('@project-user · github.com').waitFor()
      assert.deepEqual(await page.evaluate(() => window.connectionChecks.at(-1)), {
        connectionId: undefined,
        repositoryId: 'automatic',
        refresh: true,
      })
      await page.evaluate(() => {
        window.checkFailure = true
      })
      await automatic.getByRole('button', { name: 'Test connection', exact: true }).click()
      await automatic.getByRole('alert').filter({ hasText: 'GitHub rejected this token' }).waitFor()
      await automatic.getByText(/Last successful check/).waitFor()
      await page.evaluate(() => {
        window.checkFailure = false
      })
      await automatic.getByRole('button', { name: 'Test connection', exact: true }).click()
      await automatic.getByText('@runtime-user · github.com').waitFor()
      await page.evaluate(() => {
        window.runtime.connected = false
        window.render()
      })
      await automatic
        .getByText('Computer offline · Reconnect to verify this connection.')
        .first()
        .waitFor()
      assert.equal(
        await automatic.getByRole('button', { name: 'Test connection', exact: true }).isDisabled(),
        true,
      )
      await page.evaluate(() => {
        window.runtime.connected = true
        window.render()
      })
      await automatic.getByText('@runtime-user · github.com').waitFor()
      console.log(
        'Desktop shows automatic projects, verifies contextual accounts, recovers from errors and disables offline tests',
      )
    }
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
    const saveButton = page.getByRole('button', {
      name: mobile ? 'Save account' : 'Save connection',
      exact: true,
    })
    const beforeSave = await saveButton.boundingBox()
    await page.evaluate(() => {
      window.holdConnectionSave = true
    })
    await save()
    await page.waitForFunction(() => !!window.finishConnectionSave)
    await page.waitForFunction(
      (element) => element.matches(':disabled'),
      await saveButton.elementHandle(),
    )
    assert.equal(await saveButton.textContent(), mobile ? 'Save account' : 'Save connection')
    const duringSave = await saveButton.boundingBox()
    assert.deepEqual(duringSave, beforeSave, 'Saving keeps the button in the same place and size')
    await saveButton.evaluate((element) => element.click())
    assert.equal(
      await page.evaluate(() => window.connectionSaves.length),
      1,
      'Pending save prevents duplicate submissions',
    )
    await page.evaluate(() => {
      window.holdConnectionSave = false
      window.finishConnectionSave.reject(new Error('Could not save account. Try again.'))
      window.finishConnectionSave = undefined
    })
    await page
      .getByRole('alert')
      .filter({ hasText: 'Could not save account. Try again.' })
      .waitFor()
    assert.equal(
      await page.getByRole('textbox', { name: /Wrapper selectors/ }).inputValue(),
      'GH_ACCOUNT=work',
    )
    assert.equal(await saveButton.isEnabled(), true)
    await save()
    await page.waitForFunction(() => window.saved.length === 1)
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} pending saves keep their label and geometry, prevent duplicates and preserve form input after failure`,
    )
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
    await add()
    const choose = async (label, value, option) => {
      if (mobile) await page.getByRole('combobox', { name: label, exact: true }).selectOption(value)
      else {
        await page.getByRole('combobox', { name: label, exact: true }).click()
        await page.getByRole('option', { name: option, exact: true }).click()
      }
    }
    await choose(mobile ? 'Provider' : 'Source control provider', 'bitbucket', 'Bitbucket')
    await choose(
      mobile ? 'Credential' : 'Authentication method',
      'reference',
      'Secret manager reference',
    )
    await page
      .getByRole('textbox', { name: 'Atlassian account email', exact: true })
      .fill('me@example.com')
    await choose('Secret manager', 'infisical', 'Infisical')
    await page.getByRole('textbox', { name: 'Secret name', exact: true }).fill('BITBUCKET_TOKEN')
    await page.getByRole('textbox', { name: 'Infisical project ID', exact: true }).fill('project-1')
    await save()
    await page.waitForFunction(() => window.saved.length === 4)
    assert.deepEqual(await page.evaluate(() => window.connectionSaves.at(-1).secret), {
      provider: 'infisical',
      reference: 'BITBUCKET_TOKEN',
      projectId: 'project-1',
      environment: 'dev',
      path: '/',
    })
    const savedReference = await page.evaluate(() => window.saved[3])
    assert.equal(savedReference.credential, 'reference')
    assert.equal(savedReference.secretProvider, 'infisical')
    assert.equal(JSON.stringify(savedReference).includes('BITBUCKET_TOKEN'), false)
    if (!mobile) await page.getByText(/· Infisical reference$/).waitFor()
    await page
      .getByRole('button', { name: mobile ? 'Bitbucket' : 'Edit Bitbucket', exact: true })
      .click()
    await page.getByText(/Infisical reference saved on this runtime/).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Secret name' }).count(), 0)
    await page.getByRole('button', { name: 'Replace reference', exact: true }).click()
    await page.getByRole('textbox', { name: 'Secret reference', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Keep saved Infisical reference', exact: true }).click()
    await save()
    await page.waitForFunction(
      () => window.connectionSaves.at(-1).name === 'Bitbucket' && window.connectionSaves.at(-1).id,
    )
    const kept = await page.evaluate(() => window.connectionSaves.at(-1))
    assert.equal(kept.credential, 'reference')
    assert.equal(kept.secret, undefined)
    assert.equal(await page.evaluate(() => window.saved.at(-1).secretProvider), 'infisical')
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} Bitbucket secret manager references save, stay private and keep the saved reference on edit`,
    )
    if (!mobile) {
      await page.evaluate(() => {
        window.runtime.workspace.repositories.push({
          id: 'bound',
          name: 'Bound project',
          path: '/bound',
          branch: 'main',
          forge: {
            connectionId: window.saved[1].id,
            repository: 'team/app',
            revision: window.saved[1].revision,
          },
        })
        window.render()
      })
      const bound = page.getByLabel('Connection for Bound project', { exact: true })
      await bound.getByText('Bound project · team/app').waitFor()
      await bound.getByRole('button', { name: 'Test project connection' }).click()
      await bound.getByText('@project-user · github.com').waitFor()
      assert.deepEqual(await page.evaluate(() => window.connectionChecks.at(-1)), {
        connectionId: await page.evaluate(() => window.saved[1].id),
        repositoryId: 'bound',
        refresh: true,
      })
      const automatic = page.getByRole('article', {
        name: 'Automatic GitHub CLI connection',
        exact: true,
      })
      await page.evaluate(() => {
        window.diagnosticsUnavailable = true
      })
      await automatic.getByRole('button', { name: 'Test connection', exact: true }).click()
      await automatic
        .getByRole('alert')
        .filter({ hasText: 'update this computer’s runtime' })
        .waitFor()
      assert.equal(await automatic.getByText('@runtime-user · github.com').isVisible(), true)
      assert.equal(await automatic.getByText(/Last successful check/).isVisible(), true)
      console.log(
        'Desktop lists explicitly linked projects and explains unsupported runtime diagnostics',
      )
    }
    if (mobile) {
      await page.getByRole('button', { name: 'Clone a project', exact: true }).click()
      const repository = page.getByRole('textbox', { name: 'Repository', exact: true })
      const name = page.getByRole('textbox', { name: 'Project name (optional)', exact: true })
      await repository.fill('team/first-project')
      assert.equal(await name.inputValue(), 'first-project')
      await repository.fill('team/second-project')
      assert.equal(await name.inputValue(), 'second-project')
      await name.fill('My custom name')
      await repository.fill('team/third-project')
      assert.equal(await name.inputValue(), 'My custom name')
      await page.evaluate(() => window.renderPreferences())
      const retrievalSwitch = page.getByRole('switch', {
        name: 'Share retrieval with paired computers',
        exact: true,
      })
      await retrievalSwitch.waitFor()
      assert.equal(await retrievalSwitch.isChecked(), true)
      await retrievalSwitch.click()
      await page.waitForFunction(() => window.preferences.enableSharedRetrieval === false)
      await retrievalSwitch.click()
      await page.waitForFunction(() => window.preferences.enableSharedRetrieval === true)
      const toolSwitch = page.getByRole('switch', { name: 'Linked projects tool', exact: true })
      await toolSwitch.waitFor()
      assert.equal(await toolSwitch.isChecked(), true)
      await toolSwitch.click()
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="Linked projects tool"]')
            .getAttribute('aria-checked') === 'false',
      )
      assert.equal(await page.evaluate(() => window.preferences.enableLinkedProjectsTool), false)
      await toolSwitch.click()
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="Linked projects tool"]')
            .getAttribute('aria-checked') === 'true',
      )
      console.log(
        'Mobile computer preferences: linked projects tool disables and re-enables successfully',
      )
    }
    await page.evaluate(() => {
      window.diagnosticsUnavailable = false
      window.checkFailure = false
      window.renderStatus('first-account')
    })
    await page.getByRole('region', { name: 'Focused account diagnostics' }).waitFor()
    await page.getByText(/@runtime-user · github.com/).waitFor()
    for (const width of mobile ? [320, 390, 820] : [320, 1024]) {
      for (const fontScale of [1, 2]) {
        await page.setViewportSize({ width, height: 844 })
        await page.evaluate((scale) => {
          window.fontScale = scale
          document.documentElement.style.fontSize = `${16 * scale}px`
          window.renderStatus('first-account')
          return new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          )
        }, fontScale)
        await checkPendingRetest(page, page.getByLabel('GitHub connection status', { exact: true }))
      }
    }
    await page.evaluate(() => {
      window.holdConnectionCheck = true
      window.renderStatus('other-account')
    })
    await page.waitForFunction(() => !!window.finishConnectionCheck)
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="GitHub connection status"]')
          .getAttribute('aria-busy') === 'true',
    )
    assert.equal(await page.getByText(/@runtime-user · github.com/).count(), 0)
    assert.equal(await page.getByText(/Last successful check/).count(), 0)
    await page.evaluate(() => {
      window.holdConnectionCheck = false
      window.finishConnectionCheck()
      window.finishConnectionCheck = undefined
    })
    await page.getByText(/@other-user · github.com/).waitFor()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} retests preserve account details, button identity and layout at narrow/wide widths and 2× text; switching accounts clears old results`,
    )
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} saves wrapper selectors, named gh accounts and token references`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
