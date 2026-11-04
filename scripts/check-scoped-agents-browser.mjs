import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const cssServer = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let stylesheet
try {
  stylesheet = (await cssServer.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await cssServer.close()
}
const controls = `export const Icon=()=>null;import {cloneElement,isValidElement,useState,createContext,useContext} from 'react';export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)&&children.type!=='div'?cloneElement(children,{'aria-label':label}):children}</label>;export const ChoicePicker=({value,onValueChange,children,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const ModelSettings=()=>null;export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children})=><span>{children}</span>;export const Platform={OS:'ios'};export const StyleSheet={create:value=>value,hairlineWidth:1};export const useWindowDimensions=()=>({width:390,height:844,fontScale:1});export const SearchField=props=><input aria-label={props.label} value={props.value} onChange={e=>props.onChangeText?.(e.target.value)}/>;export const styles={row:{}};export const MobileThemeContext=createContext({styles,colors:{text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'},mode:'dark',palette:'dovo'});export const useTheme=()=>useContext(MobileThemeContext);export const colors={text:'#fff',muted:'#aaa',accent:'#9cf',border:'#333'};export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const Field=({label,value,onChangeText,multiline,editable})=><label>{label}{multiline?<textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/>}</label>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:async run=>{setBusy(true);try{await run()}catch(e){setError(String(e))}finally{setBusy(false)}}}};export const Dialog=({children})=><div role="dialog">{children}</div>;export const DialogContent=View;export const DialogDescription=Text;export const DialogHeader=View;export const DialogTitle=Text;export const useInsideSheet=()=>false;export const Sheet=({children,title})=><div role="dialog">{title}{children}</div>;export const AgentAvatar=()=>null;export const agentIconChoices={};export const PageHeader=({title})=><h1>{title}</h1>;export const ScreenHeader=PageHeader;export const TaskDefaultSettings=()=> <p>Default agent settings</p>;export const HarnessLabel=({agent})=><span>{agent.provider}</span>;export const ModelLabel=({agent})=><span>{agent.model}</span>;`
const state = `export {useState as useApplicationState} from 'react';`
// Desktop geometry checks need the production field and dialog markup, including their CSS hooks.
const desktopControls = `export {Button} from '${root}/packages/studio-ui/src/components/ui/button.tsx';export {Input} from '${root}/packages/web-ui/src/input.tsx';export {Textarea} from '${root}/packages/web-ui/src/textarea.tsx';export {FormField} from '${root}/packages/studio-ui/src/components/form-field.tsx';export {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '${root}/packages/web-ui/src/dialog.tsx';export const AgentAvatar=()=>null;export const agentIconChoices={};export const ChoicePicker=({value,onValueChange,children,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const core = `export {ConfirmationContext,useConfirmation} from '${root}/packages/studio-core/src/confirmation.tsx';import {createContext,useContext} from 'react';export {selectableAccessModes,supportsAccess,agentSchema} from '@dovo/protocol';export {SettingsTargetProvider,useSettingsTarget,useOptionalSettingsTarget,useSettingsDraft} from '${root}/packages/studio-core/src/settings-target.tsx';export const useStudioHost=()=>({navigate:target=>window.navigation=target});export {providers} from '${root}/packages/studio-core/src/providers.ts';const Scope=createContext(null);export const useWorkspace=()=>useContext(Scope)||window.runtime;export const WorkspaceScope=({profile,children})=>{const entry=window.sources.find(entry=>entry.profile.id===profile.id);return <Scope.Provider value={{...window.runtime,activeRuntimeId:profile.id,workspace:entry.snapshot.workspace,snapshot:entry.snapshot,connected:entry.connected,request:window.requests[profile.id]}}><div data-owner={profile.id}>{children}</div></Scope.Provider>};`
    const native = `import {createContext,useContext} from 'react';import {Effect} from 'effect';const Scope=createContext(null);export const useRuntime=()=>useContext(Scope)||window.runtime;export const RuntimeScope=({runtimeId,children})=>{const entry=window.sources.find(entry=>entry.profile.id===runtimeId);return <Scope.Provider value={{...window.runtime,profile:entry.profile,snapshot:entry.snapshot,connected:entry.connected,callEffect:window.effects[runtimeId]}}><div data-owner={runtimeId}>{children}</div></Scope.Provider>};`
    const mocks = {
      '@dovo/studio-core': core,
      './workspace/context': `export {useWorkspace} from '@dovo/studio-core';`,
      '@dovo/studio-core/state': state,
      '../runtime/state/application-state': state,
      '../state/application-state': state,
      './runtime/application-state': state,
      'native-runtime': native,
      '../runtime/connection/provider': native,
      '../connection/provider': native,
      './workspace/provider': `export const useWorkspace=()=>window.runtime;`,
      './workspace/runtime-sources': `export const useRuntimeSources=()=>window.sources;`,
      'react-native':
        controls + `export const Alert={alert:(title,message,buttons)=>buttons.at(-1).onPress()};`,
      '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;export {clientScopeKey} from '${root}/packages/client-runtime/src/effects/request-scope.ts';`,
      'expo-router': `export const router={push:()=>{}};`,
      'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
      '@dovo/studio-ui':
        (mobile ? controls : desktopControls) +
        `export {Disclosure} from '${root}/packages/studio-ui/src/disclosure.tsx';` +
        `export {SettingsSaveBar} from '${root}/packages/studio-ui/src/settings-layout.tsx';export {PermissionPolicyFields,permissionPolicyUIIssue} from '${root}/packages/studio-ui/src/permission-policy-fields';export {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '${root}/packages/studio-ui/src/components/ui/select.tsx';export {SettingSource} from '${root}/packages/studio-ui/src/setting-source.tsx';export {SettingsScopePage} from '${root}/packages/studio-ui/src/settings-scope-page.tsx';`,
    }
    const built = await build({
      stdin: {
        contents: `import {StudioConfirmationProvider} from '${root}/packages/studio-ui/src/confirmation-provider.tsx';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import Agents from '${root}/${mobile ? 'apps/mobile/src/screens/agents' : 'packages/extension-agents/src/view'}.tsx';import {SettingsTargetProvider} from '${root}/${mobile ? 'apps/mobile/src/runtime/preferences' : 'packages/studio-core/src'}/settings-target.tsx';window.crypto.randomUUID=()=>Math.random().toString(36).slice(2);const writer={id:'writer',name:'Writer',provider:'codex',model:'gpt-6.1-sol',reasoning:'',instructions:'Inherited instructions',permission:'ask',endpoint:''};const repo={id:'mac-repo',name:'Project',path:'/repo',branch:'main',gitIdentity:'github.com/team/repo'};window.sources=['mac','linux'].map(id=>({profile:{id,name:id,connection:{address:'http://'+id+'.local',token:'test'}},name:id,scope:id,connected:true,snapshot:{scopedAgentsSupported:true,defaults:{scopedSettings:{environment:{},shared:[{key:'global',updatedAt:1,changeId:'a',value:{agents:[writer]}}]}},workspace:{agents:[],repositories:[{...repo,id:id+'-repo'}]}}}));window.writes=[];window.docs={};window.requests={};window.effects={};for(const source of window.sources){const id=source.profile.id;window.requests[id]=async(path,input)=>{const key=id+':'+input.scope+':'+(input.repositoryId||'');if(path.endsWith('/read'))return {value:window.docs[key]??(input.scope==='global'?{agents:[writer]}:{agents:[]}),inherited:input.scope==='global'?{}:{agents:[writer]},projectKey:input.repositoryId?'project:github.com/team/repo':undefined};if(path.endsWith('/save')){if(window.rejectSave)throw Error('Save rejected');window.writes.push({host:id,...input});window.docs[key]=input.after;return {value:input.after,inherited:input.scope==='global'?{}:{agents:[writer]}}}throw Error(path)};window.effects[id]=(path,input)=>Effect.tryPromise(()=>window.requests[id](path,input));}window.runtime={runtimes:window.sources,overviews:window.sources,activeId:'mac',activeRuntimeId:'mac',refreshRuntimes:async()=>{}};createRoot(document.getElementById('app')).render(<StudioConfirmationProvider><SettingsTargetProvider><Agents/></SettingsTargetProvider></StudioConfirmationProvider>);`,
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
              if (
                path === '../runtime/connection/provider' ||
                path === '../connection/provider' ||
                path === '../../runtime/connection/provider'
              )
                return { path: 'native-runtime', namespace: 'mock' }
              if (mocks[path]) return { path, namespace: 'mock' }
              if (/(harness-updates|acp-registry|title-settings|provider-check)$/.test(path))
                return { path: 'tools', namespace: 'mock' }
              if (
                /(task-default-settings|model-settings|choice-picker|page-header|screen-header|model-label)$|ui\/(layout\/sheet|controls\/(action|choice|field|use-action|icon)|content\/text|theme)$/.test(
                  path,
                )
              )
                return { path: 'controls', namespace: 'mock' }
            })
            b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents:
                path === 'controls'
                  ? controls
                  : path === 'tools'
                    ? `export const HarnessUpdates=()=>null;export const AcpRegistrySettings=()=>null;export const TitleSettings=()=>null;export const AcpRegistry=()=>null;export const ProviderCheck=()=>null;`
                    : mocks[path],
              loader: 'tsx',
              resolveDir: root + '/apps/mobile',
            }))
          },
        },
      ],
    })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    page.on('dialog', (dialog) => dialog.accept())
    await page.setContent('<div id="app" style="display:flex;height:100dvh"></div>')
    if (!mobile) await page.addStyleTag({ content: stylesheet })
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const assertUnobstructed = async (locator) => {
      await locator.scrollIntoViewIfNeeded()
      assert.equal(
        await locator.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const hit = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          )
          return hit === element || element.contains(hit)
        }),
        true,
        `Control is obscured: ${(await locator.getAttribute('aria-label')) ?? (await locator.textContent())}`,
      )
    }
    const assertInstructionTypography = async (editor) => {
      const instructions = editor.getByLabel('Instructions', { exact: true })
      const typography = await instructions.evaluate((element) => {
        const style = getComputedStyle(element)
        const inputStyle = getComputedStyle(element.closest('form').querySelector('input'))
        return {
          fontSize: style.fontSize,
          inputFontSize: inputStyle.fontSize,
          fontWeight: style.fontWeight,
          rows: element.rows,
          readableLines: Math.round(
            (element.clientHeight -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom)) /
              parseFloat(style.lineHeight),
          ),
        }
      })
      assert.equal(typography.fontSize, typography.inputFontSize)
      assert.equal(typography.fontWeight, '400')
      assert.equal(typography.rows, 6)
      assert.ok(typography.readableLines >= 6)
    }
    const setCloudIntegrations = async (value, label) => {
      const scope = (await page.getByRole('dialog').count()) ? page.getByRole('dialog') : page
      const picker = scope.getByRole('combobox', { name: 'Cloud integrations', exact: true })
      if (mobile) await picker.selectOption(value)
      else {
        await picker.click()
        await page.getByRole('option', { name: label, exact: true }).click()
      }
    }
    const project = page.getByLabel(mobile ? 'Project' : 'Settings project', { exact: true })
    const environment = page.getByLabel(mobile ? 'Computer' : 'Settings computer', {
      exact: true,
    })
    await (
      mobile
        ? page.getByRole('button', { name: 'Configure', exact: true })
        : page
            .getByRole('navigation', { name: 'Provider configurations' })
            .getByRole('button', { name: /Writer/ })
    ).waitFor()
    await project.selectOption('git:github.com/team/repo')
    await environment.selectOption('linux')
    if (mobile) await page.getByRole('button', { name: 'Override', exact: true }).click()
    else await page.getByLabel('Name', { exact: true }).waitFor()
    if (!mobile) {
      const helper = page.getByText(/Use apps already connected to your/)
      const cleanNote = page.getByText(/^Changes apply to new turns on/)
      for (const dark of [false, true]) {
        await page
          .locator('html')
          .evaluate((element, dark) => element.classList.toggle('dark', dark), dark)
        await helper.evaluate((element) => {
          const scroll = element.closest('.studio-settings-scroll')
          scroll.scrollTop +=
            element.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom + 4
        })
        const helperBounds = await helper.boundingBox()
        const noteBounds = await cleanNote.boundingBox()
        assert.ok(noteBounds.y >= helperBounds.y + helperBounds.height)
        await assertUnobstructed(helper)
      }
      await assertInstructionTypography(page)
    }
    assert.equal(await page.getByLabel('Configuration scope', { exact: true }).count(), 0)
    await page.getByLabel('Name', { exact: true }).fill('Project writer')
    await setCloudIntegrations('false', 'Disabled')
    await page
      .getByRole('button', { name: mobile ? 'Save agent' : 'Save changes', exact: true })
      .click()
    if (mobile)
      await page
        .getByRole('button', { name: 'More actions for Project writer', exact: true })
        .click()
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor()
    assert.deepEqual(
      await page.evaluate(() => ({
        host: window.writes.at(-1).host,
        scope: window.writes.at(-1).scope,
        repository: window.writes.at(-1).repositoryId,
        agent: window.writes.at(-1).after.agents[0].id,
        instructions: window.writes.at(-1).after.agents[0].instructions,
        cloudIntegrations: window.writes.at(-1).after.agents[0].cloudIntegrations,
      })),
      {
        host: 'linux',
        scope: 'environment-project',
        repository: 'linux-repo',
        agent: 'writer',
        instructions: 'Inherited instructions',
        cloudIntegrations: false,
      },
    )
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await (
      mobile
        ? page.getByRole('button', { name: 'Override', exact: true })
        : page.getByText(/Saving creates an override/)
    ).waitFor()
    assert.deepEqual(await page.evaluate(() => window.writes.at(-1).after.agents), [])
    await page
      .getByRole('button', { name: mobile ? 'New configuration' : 'Add profile', exact: true })
      .click()
    const editor = mobile ? page : page.getByRole('dialog')
    if (!mobile) {
      await editor.getByRole('button', { name: 'Claude Code', exact: true }).click()
      await editor.getByRole('button', { name: 'Next', exact: true }).click()
    }
    await editor.getByLabel('Name', { exact: true }).fill('Research')
    if (mobile) await editor.getByLabel('Provider', { exact: true }).selectOption('claude')
    else {
      await editor.getByRole('button', { name: 'Next', exact: true }).click()
      await editor.getByRole('button', { name: 'Back', exact: true }).click()
      assert.equal(await editor.getByLabel('Name', { exact: true }).inputValue(), 'Research')
      await editor.getByRole('button', { name: 'Next', exact: true }).click()
    }
    if (!mobile) {
      await editor.getByText('Connection & account', { exact: true }).click()
      for (const { width, height } of [
        { width: 1280, height: 800 },
        { width: 390, height: 540 },
      ]) {
        await page.setViewportSize({ width, height })
        await assertInstructionTypography(editor)
        await assertUnobstructed(editor.getByLabel('Environment variables', { exact: true }))
        await assertUnobstructed(
          editor.getByRole('button', { name: 'Add agent profile', exact: true }),
        )
        const modalBounds = await editor.boundingBox()
        assert.ok(modalBounds.y >= 0 && modalBounds.y + modalBounds.height <= height)
        if (width === 390) {
          const writesBefore = await page.evaluate(() => window.writes.length)
          await editor.getByLabel('Environment variables', { exact: true }).fill('INVALID LINE')
          await editor.getByRole('button', { name: 'Add agent profile', exact: true }).click()
          await assertUnobstructed(editor.getByRole('alert'))
          assert.equal(await page.evaluate(() => window.writes.length), writesBefore)
          await editor.getByLabel('Environment variables', { exact: true }).fill('')
        }
      }
      await page.setViewportSize({ width: 1280, height: 800 })
    }
    await setCloudIntegrations('true', 'Enabled')
    await setCloudIntegrations('default', 'Provider default')
    await setCloudIntegrations('true', 'Enabled')
    await editor
      .getByRole('button', { name: mobile ? 'Save agent' : 'Add agent profile', exact: true })
      .click()
    await (
      mobile
        ? page.getByText('Research', { exact: true })
        : page
            .getByRole('navigation', { name: 'Provider configurations' })
            .getByRole('button', { name: /Research/ })
    ).waitFor()
    assert.equal(await page.evaluate(() => window.writes.at(-1).after.agents[0].provider), 'claude')
    assert.equal(
      await page.evaluate(() => window.writes.at(-1).after.agents[0].cloudIntegrations),
      true,
    )
    await page
      .getByRole('button', { name: mobile ? 'New configuration' : 'Add profile', exact: true })
      .click()
    if (mobile) await editor.getByLabel('Provider', { exact: true }).selectOption('cursor')
    else await editor.getByRole('button', { name: 'Cursor', exact: true }).click()
    if (!mobile) await editor.getByRole('button', { name: 'Next', exact: true }).click()
    assert.equal(
      await editor.getByRole('combobox', { name: 'Cloud integrations', exact: true }).count(),
      0,
    )
    await editor.getByLabel('Name', { exact: true }).fill('Cursor worker')
    if (!mobile) await editor.getByRole('button', { name: 'Next', exact: true }).click()
    if (mobile) {
      assert.equal(
        await editor.getByLabel('Access mode', { exact: true }).inputValue(),
        'read-only',
      )
      assert.deepEqual(
        await editor
          .getByLabel('Access mode', { exact: true })
          .locator('option')
          .evaluateAll((rows) => rows.map((row) => row.value)),
        ['read-only', 'auto', 'full-access'],
      )
    } else {
      const access = editor.getByRole('combobox', { name: 'Access mode', exact: true })
      assert.match(await access.textContent(), /Read/)
      await access.click()
      assert.deepEqual(await page.getByRole('option').allTextContents(), [
        'Read only',
        'Auto-review',
        'Full access',
      ])
      await page.keyboard.press('Escape')
    }
    assert.equal(
      await editor
        .getByLabel(mobile ? 'Executable path · blank uses default' : 'Connection / executable', {
          exact: true,
        })
        .count(),
      0,
    )
    assert.equal(
      await editor
        .getByLabel(mobile ? 'Arguments · one per line' : 'Executable arguments (one per line)', {
          exact: true,
        })
        .count(),
      0,
    )
    await editor.getByText('Connection & account', { exact: true }).click()
    await editor.getByText(/Cursor desktop login is separate/).waitFor()
    await editor
      .getByRole('button', { name: mobile ? 'Save agent' : 'Add agent profile', exact: true })
      .click()
    await (
      mobile
        ? page.getByText('Cursor worker', { exact: true })
        : page
            .getByRole('navigation', { name: 'Provider configurations' })
            .getByRole('button', { name: /Cursor worker/ })
    ).waitFor()
    assert.deepEqual(
      await page.evaluate(() => {
        const agent = window.writes
          .at(-1)
          .after.agents.find((agent) => agent.name === 'Cursor worker')
        return { provider: agent.provider, permission: agent.permission }
      }),
      { provider: 'cursor', permission: 'read-only' },
    )
    if (!mobile) {
      const navigation = page.getByRole('navigation', { name: 'Provider configurations' })
      const researchRow = navigation.getByRole('button', { name: /Research/ })
      assert.equal(await researchRow.getByText('Default model', { exact: true }).count(), 0)
      assert.equal(await researchRow.locator(':scope > span > span').count(), 2)
      assert.match(await researchRow.textContent(), /Claude.*Customized here/)
      await navigation.getByRole('button', { name: /Research/ }).click()
      assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Research')
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(
        await page.getByRole('combobox', { name: 'Cloud integrations', exact: true }).textContent(),
        'Enabled',
      )
      await setCloudIntegrations('false', 'Disabled')
      const writesBefore = await page.evaluate(() => window.writes.length)
      await page.getByText('Connection & account', { exact: true }).click()
      const env = page.getByRole('textbox', { name: /^Environment variables/ })
      await env.fill('INVALID LINE')
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await page.getByRole('alert').waitFor()
      assert.equal(await page.evaluate(() => window.writes.length), writesBefore)
      await env.fill('EXAMPLE=value')
      await page.getByLabel('Instructions', { exact: true }).fill('Updated instructions')
      const scroll = page.getByRole('region', { name: 'Agents settings', exact: true })
      const saveActions = page.getByRole('group', { name: 'Settings save actions', exact: true })
      for (const { width, dark } of [1280, 390].flatMap((width) =>
        [false, true].map((dark) => ({ width, dark })),
      )) {
        await page.setViewportSize({ width, height: 800 })
        await page
          .locator('html')
          .evaluate((element, dark) => element.classList.toggle('dark', dark), dark)
        await assertInstructionTypography(page)
        for (const position of [0, 0.45, 1]) {
          await scroll.evaluate((element, position) => {
            element.scrollTop = position * (element.scrollHeight - element.clientHeight)
          }, position)
          const bounds = await saveActions.boundingBox()
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)
          assert.ok(
            bounds.y >= 0 && bounds.y + bounds.height <= 800,
            JSON.stringify({ width, position, bounds }),
          )
          if (position < 1) {
            assert.equal(
              await saveActions.evaluate((element) => {
                const footer = element.parentElement.parentElement
                const scroll = document.querySelector('.studio-settings-scroll')
                const bounds = scroll.getBoundingClientRect()
                const hit = document.elementFromPoint(
                  element.getBoundingClientRect().left + 2,
                  bounds.bottom - 1,
                )
                return (
                  footer.contains(hit) &&
                  getComputedStyle(footer).backgroundColor !== 'rgba(0, 0, 0, 0)'
                )
              }),
              true,
              `Footer leaves content visible at the scrollport bottom (${width}, ${position})`,
            )
          }
          await saveActions.getByRole('button', { name: 'Save changes', exact: true }).waitFor()
          await saveActions.getByRole('button', { name: 'Discard', exact: true }).waitFor()
        }
        await assertUnobstructed(env)
        await assertUnobstructed(page.getByText('Check installation & sign-in', { exact: true }))
      }
      // Discard stays reachable from the top of a long profile and restores every draft field.
      await scroll.evaluate((element) => {
        element.scrollTop = 0
      })
      await saveActions.getByRole('button', { name: 'Discard', exact: true }).click()
      assert.equal(await page.getByLabel('Instructions', { exact: true }).inputValue(), '')
      assert.equal(await env.inputValue(), '')
      await env.fill('EXAMPLE=value')
      await page.getByLabel('Instructions', { exact: true }).fill('Updated instructions')
      await setCloudIntegrations('false', 'Disabled')
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.evaluate(() => (window.rejectSave = true))
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Save rejected' }).waitFor()
      await assertUnobstructed(page.getByRole('alert').filter({ hasText: 'Save rejected' }))
      assert.equal(
        await page.getByLabel('Instructions', { exact: true }).inputValue(),
        'Updated instructions',
      )
      assert.equal(await page.evaluate(() => window.writes.length), writesBefore)
      await page.evaluate(() => (window.rejectSave = false))
      await page.getByRole('button', { name: 'Save changes', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Research saved' }).waitFor()
      assert.deepEqual(
        await page.evaluate(() => {
          const agent = window.writes.at(-1).after.agents.find((agent) => agent.name === 'Research')
          return {
            instructions: agent.instructions,
            env: agent.env,
            cloudIntegrations: agent.cloudIntegrations,
          }
        }),
        {
          instructions: 'Updated instructions',
          env: { EXAMPLE: 'value' },
          cloudIntegrations: false,
        },
      )
      await page.getByLabel('Instructions', { exact: true }).fill('Unsaved changes')
      await navigation.getByRole('button', { name: /Cursor worker/ }).click()
      const confirmation = page.getByRole('dialog')
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.equal(
        await page.getByLabel('Instructions', { exact: true }).inputValue(),
        'Unsaved changes',
      )
      await navigation.getByRole('button', { name: /Cursor worker/ }).click()
      await confirmation.getByRole('button', { name: 'Discard changes', exact: true }).click()
      assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Cursor worker')
    }
    if (!mobile) {
      await project.selectOption('')
      await page.locator('summary[data-setting-label="Installations & sign-in"]').click()
      await page.getByRole('button', { name: 'Configure titles & dictation', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.navigation), {
        viewId: 'text-generation',
        entityId: 'linux',
      })
      const writesBeforeUpgrade = await page.evaluate(() => {
        window.sources.find(
          (source) => source.profile.id === 'linux',
        ).snapshot.scopedAgentsSupported = false
        return window.writes.length
      })
      await project.selectOption('git:github.com/team/repo')
      await page.getByRole('status').filter({ hasText: 'Update Dovo on linux' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Add profile', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Open Devices & runtime', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.navigation), { viewId: 'runtime' })
      assert.equal(await page.evaluate(() => window.writes.length), writesBeforeUpgrade)
      await page.evaluate(() => {
        window.sources.find(
          (source) => source.profile.id === 'mac',
        ).snapshot.scopedAgentsSupported = false
      })
      await environment.selectOption('')
      await page.getByRole('status').filter({ hasText: 'Update Dovo on mac' }).waitFor()
      assert.equal(await environment.isEnabled(), true)
      assert.equal(await project.isEnabled(), true)
      await environment.selectOption('linux')
      await page.getByRole('status').filter({ hasText: 'Update Dovo on linux' }).waitFor()
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      (mobile ? 'Mobile' : 'Desktop') +
        ' scoped agents: inherited override, reset, host/project ownership, account apps, Cursor SDK access/auth fields and editor save passed',
    )
  }
} finally {
  await browser.close()
}
