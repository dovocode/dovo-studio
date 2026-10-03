import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const controls = `import {cloneElement,isValidElement,useState} from 'react';export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)?cloneElement(children,{'aria-label':label}):children}</label>;export const ChoicePicker=({value,onValueChange,children,...props})=><select {...props} value={value} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const ModelSettings=()=>null;export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children})=><span>{children}</span>;export const styles={row:{}};export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const Field=({label,value,onChangeText,multiline,editable})=><label>{label}{multiline?<textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>:<input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/>}</label>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:async run=>{setBusy(true);try{await run()}catch(e){setError(String(e))}finally{setBusy(false)}}}};export const Dialog=({children})=><div role="dialog">{children}</div>;export const DialogContent=View;export const DialogDescription=Text;export const DialogHeader=View;export const DialogTitle=Text;export const Sheet=({children,title})=><div role="dialog">{title}{children}</div>;export const AgentAvatar=()=>null;export const agentIconChoices={};export const PageHeader=({title})=><h1>{title}</h1>;export const ScreenHeader=PageHeader;export const TaskDefaultSettings=()=> <p>Default agent settings</p>;export const HarnessLabel=({agent})=><span>{agent.provider}</span>;export const ModelLabel=({agent})=><span>{agent.model}</span>;`
const state = `export {useState as useApplicationState} from 'react';`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const core = `import {createContext,useContext} from 'react';export {selectableAccessModes,supportsAccess,agentSchema} from '@dovo/protocol';export {SettingsTargetProvider,useSettingsTarget} from '${root}/packages/studio-core/src/settings-target.tsx';export const providers={codex:{name:'Codex'},claude:{name:'Claude'},opencode:{name:'OpenCode'},acp:{name:'ACP'}};const Scope=createContext(null);export const useWorkspace=()=>useContext(Scope)||window.runtime;export const WorkspaceScope=({profile,children})=>{const entry=window.sources.find(entry=>entry.profile.id===profile.id);return <Scope.Provider value={{...window.runtime,workspace:entry.snapshot.workspace,snapshot:entry.snapshot,connected:entry.connected,request:window.requests[profile.id]}}><div data-owner={profile.id}>{children}</div></Scope.Provider>};`
    const native = `import {createContext,useContext} from 'react';import {Effect} from 'effect';const Scope=createContext(null);export const useRuntime=()=>useContext(Scope)||window.runtime;export const RuntimeScope=({runtimeId,children})=>{const entry=window.sources.find(entry=>entry.profile.id===runtimeId);return <Scope.Provider value={{...window.runtime,profile:entry.profile,snapshot:entry.snapshot,connected:entry.connected,callEffect:window.effects[runtimeId]}}><div data-owner={runtimeId}>{children}</div></Scope.Provider>};`
    const mocks = {
      '@dovo/studio-core': core,
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
      '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;`,
      'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
      '@dovo/studio-ui':
        controls +
        `export {SettingsScopePage} from '${root}/packages/studio-ui/src/settings-scope-page.tsx';`,
    }
    const built = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import Agents from '${root}/${mobile ? 'apps/mobile/src/screens/agents' : 'packages/extension-agents/src/view'}.tsx';import {SettingsTargetProvider} from '${root}/${mobile ? 'apps/mobile/src/runtime/preferences' : 'packages/studio-core/src'}/settings-target.tsx';window.crypto.randomUUID=()=>Math.random().toString(36).slice(2);const writer={id:'writer',name:'Writer',provider:'codex',model:'gpt-6.1-sol',reasoning:'',instructions:'Inherited instructions',permission:'ask',endpoint:''};const repo={id:'mac-repo',name:'Project',path:'/repo',branch:'main',gitIdentity:'github.com/team/repo'};window.sources=['mac','linux'].map(id=>({profile:{id,name:id,connection:{address:'http://'+id+'.local',token:'test'}},name:id,scope:id,connected:true,snapshot:{scopedAgentsSupported:true,defaults:{scopedSettings:{environment:{},shared:[{key:'global',updatedAt:1,changeId:'a',value:{agents:[writer]}}]}},workspace:{agents:[],repositories:[{...repo,id:id+'-repo'}]}}}));window.writes=[];window.docs={};window.requests={};window.effects={};for(const source of window.sources){const id=source.profile.id;window.requests[id]=async(path,input)=>{const key=id+':'+input.scope+':'+(input.repositoryId||'');if(path.endsWith('/read'))return {value:window.docs[key]??(input.scope==='global'?{agents:[writer]}:{agents:[]}),inherited:input.scope==='global'?{}:{agents:[writer]},projectKey:input.repositoryId?'project:github.com/team/repo':undefined};if(path.endsWith('/save')){window.writes.push({host:id,...input});window.docs[key]=input.after;return {value:input.after,inherited:input.scope==='global'?{}:{agents:[writer]}}}throw Error(path)};window.effects[id]=(path,input)=>Effect.tryPromise(()=>window.requests[id](path,input));}window.runtime={overviews:window.sources,activeId:'mac',activeRuntimeId:'mac',refreshRuntimes:async()=>{}};createRoot(document.getElementById('app')).render(<SettingsTargetProvider><Agents/></SettingsTargetProvider>);`,
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
              if (path === '../runtime/connection/provider' || path === '../connection/provider')
                return { path: 'native-runtime', namespace: 'mock' }
              if (mocks[path]) return { path, namespace: 'mock' }
              if (/(harness-updates|acp-registry|title-settings|provider-check)$/.test(path))
                return { path: 'tools', namespace: 'mock' }
              if (
                /(task-default-settings|model-settings|choice-picker|page-header|screen-header|model-label)$|ui\/(layout\/sheet|controls\/(action|choice|field|use-action)|content\/text|theme)$/.test(
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
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('dialog', (dialog) => dialog.accept())
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const project = page.getByLabel(mobile ? 'Project' : 'Settings project', { exact: true })
    const environment = page.getByLabel(mobile ? 'Environment' : 'Settings environment', {
      exact: true,
    })
    await page.getByRole('button', { name: 'Configure', exact: true }).waitFor()
    await project.selectOption('git:github.com/team/repo')
    await environment.selectOption('linux')
    await page.getByRole('button', { name: 'Override', exact: true }).click()
    assert.equal(await page.getByLabel('Configuration scope', { exact: true }).count(), 0)
    await page.getByLabel('Name', { exact: true }).fill('Project writer')
    await page
      .getByRole('button', { name: mobile ? 'Save agent' : 'Save configuration', exact: true })
      .click()
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor()
    assert.deepEqual(
      await page.evaluate(() => ({
        host: window.writes.at(-1).host,
        scope: window.writes.at(-1).scope,
        repository: window.writes.at(-1).repositoryId,
        agent: window.writes.at(-1).after.agents[0].id,
        instructions: window.writes.at(-1).after.agents[0].instructions,
      })),
      {
        host: 'linux',
        scope: 'environment-project',
        repository: 'linux-repo',
        agent: 'writer',
        instructions: 'Inherited instructions',
      },
    )
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await page.getByRole('button', { name: 'Override', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.writes.at(-1).after.agents), [])
    await page.getByRole('button', { name: 'New configuration', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Research')
    await page.getByLabel('Provider', { exact: true }).selectOption('claude')
    await page
      .getByRole('button', { name: mobile ? 'Save agent' : 'Save configuration', exact: true })
      .click()
    await page.getByText('Research', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.writes.at(-1).after.agents[0].provider), 'claude')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      (mobile ? 'Mobile' : 'Desktop') +
        ' scoped agents: inherited override, reset, host/project ownership and editor save passed',
    )
  }
} finally {
  await browser.close()
}
