import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const ui = `${root}packages/studio-ui/`
const mobile = `${root}apps/mobile/src/`
const require = createRequire(`${ui}package.json`)
// Real desktop and native permission components; native platform primitives render to DOM.
// Discovery/provider execution is outside this test, and all writes stay in the fixture.
const moduleMocks = new Map([
  [`${mobile}agents/harness-icon.tsx`, `export const HarnessIcon=()=>null;`],
  [
    `${mobile}agents/use-model-catalog.ts`,
    `export const useModelCatalog=()=>({catalog:{models:[],reasoning:[]},loading:false,refresh:()=>{}});export const useCachedModelCatalog=agent=>({catalog:null,modelName:agent?.model??''});`,
  ],
  [
    `${ui}src/harness-catalog.ts`,
    `export const useHarnessCatalog=()=>({catalog:{models:[{id:'model',name:'Model',isDefault:true}],reasoning:[]},loading:false,error:null});`,
  ],
  [
    `${ui}src/use-harness-availability.ts`,
    `export const useHarnessAvailability=()=>({available:new Set(['harness:codex','harness:claude']),loading:false,error:null});`,
  ],
  [`${ui}src/model-settings.tsx`, `export const ModelSettings=()=>null;`],
  [`${ui}src/setting-source.tsx`, `export const SettingSource=()=>null;`],
  [
    `${root}packages/extension-agents/src/model-settings.tsx`,
    `export const ModelSettings=()=>null;`,
  ],
  [`${root}packages/extension-agents/src/acp-registry.tsx`, `export const AcpRegistry=()=>null;`],
  [`${mobile}agents/model-settings.tsx`, `export const ModelSettings=()=>null;`],
  [
    `${mobile}agents/model-label.tsx`,
    `export const ModelLabel=()=> 'Model';export const HarnessLabel=()=> 'Harness';`,
  ],
  [
    `${root}packages/extension-tasks/src/dialogs/harness-dialog.tsx`,
    `export const HarnessDialog=()=>null;`,
  ],
  [`${mobile}agents/acp-registry.tsx`, `export const AcpRegistry=()=>null;`],
  [
    `${mobile}agents/use-harness-availability.ts`,
    `export const useHarnessAvailability=()=>({available:new Set(['harness:codex','harness:claude','agent:preset']),loading:false,error:null});`,
  ],
  [
    `${mobile}runtime/state/application-state.ts`,
    `export {useState as useApplicationState} from 'react';`,
  ],
  [
    `${mobile}runtime/connection/provider.tsx`,
    `import {createContext,useContext} from 'react';export const RuntimeContext=createContext(null);export const useRuntime=()=>useContext(RuntimeContext);`,
  ],
  [`${mobile}runtime/preferences/settings-target.tsx`, `export const useSettingsDraft=()=>{};`],
  [`${mobile}runtime/preferences/setting-source.tsx`, `export const SettingSource=()=>null;`],
  [
    `${mobile}screens/settings-theme.tsx`,
    `export const useInsideSettings=()=>true;export {useTheme as useSettingsTheme} from '${mobile}ui/theme';export const SettingsSheet=({children})=><section>{children}</section>;`,
  ],
  [
    `${mobile}screens/settings-group.tsx`,
    `export const SettingsGroup=({title,children})=><section aria-label={title}><h3>{title}</h3>{children}</section>;`,
  ],
  [
    `${mobile}ui/theme.ts`,
    `export const colors={surface:'#20232d',selection:'#343845',text:'#eee',muted:'#aab',accent:'#8cf',error:'#f88',action:'#568',onAccent:'#fff',border:'#445'};export const styles={text:{color:colors.text},muted:{color:colors.muted,fontSize:12},error:{color:colors.error},row:{display:'flex',gap:8}};export const MobileThemeContext={Provider:({children})=>children};export const useTheme=()=>({colors,styles});`,
  ],
  [
    `${mobile}ui/content/text.tsx`,
    `export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={Array.isArray(style)?Object.assign({},...style):style}>{children}</span>;`,
  ],
  [
    `${mobile}ui/controls/icon-button.tsx`,
    `export const IconButton=({label,onPress,disabled})=><button aria-label={label} onClick={onPress} disabled={disabled}>{label}</button>;`,
  ],
  [`${mobile}ui/controls/icon.tsx`, `export const Icon=()=>null;`],
  [`${mobile}ui/controls/choice-menu.tsx`, `export const ChoiceMenu=()=>null;`],
  [
    `${mobile}ui/layout/sheet.tsx`,
    `export const Sheet=({title,children})=><section aria-label={title}>{children}</section>;export const useInsideSheet=()=>true;`,
  ],
  [
    `${mobile}ui/controls/field.tsx`,
    `export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;export const Field=({label,value,onChangeText,editable=true})=><label>{label}<input aria-label={label} value={value??''} onChange={event=>onChangeText(event.target.value)} disabled={!editable}/></label>;`,
  ],
  [`${mobile}ui/controls/switch.tsx`, `export const Switch=()=>null;`],
])
const mocks = {
  '@dovo/protocol': `export * from '${root}packages/protocol/src/index.ts';`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-core': `export * from '@dovo/protocol';export {providers} from '${root}packages/studio-core/src/providers';export {updateTask} from '${root}packages/studio-core/src/workspace/actions';import {createContext,useContext} from 'react';export const WorkspaceContext=createContext(null);export const useWorkspace=()=>useContext(WorkspaceContext);export const useSettingsDraft=()=>{};`,
  '@dovo/studio-ui': `export {ComposerSettingsControls} from '${ui}src/composer-settings-controls';export {PermissionPolicyFields,permissionPolicyUIIssue} from '${ui}src/permission-policy-fields';export {AgentAvatar,agentIconChoices} from '${ui}src/agent-avatar';export {FormField} from '${ui}src/components/form-field';export {Button} from '${ui}src/components/ui/button';export {Input} from '${ui}src/components/ui/input';export {Textarea} from '${ui}src/components/ui/textarea';export * from '${ui}src/components/ui/select';export * from '${ui}src/components/ui/dialog';`,
  'react-native': `
    export const Platform={OS:'android'};
    export const Alert={alert:()=>{}};
    export const useWindowDimensions=()=>({width:390,height:844,fontScale:1});
    export const View=({children,style})=><div style={Array.isArray(style)?Object.assign({},...style):style}>{children}</div>;
    export const ScrollView=({children})=><div>{children}</div>;
    export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState,style})=><button aria-label={accessibilityLabel} role={accessibilityRole} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} disabled={disabled} onClick={onPress} style={typeof style==='function'?Object.assign({},...[style({pressed:false})].flat()):style}>{children}</button>;
  `,
  'react-native/Libraries/Components/TextInput/TextInputState': `export default {currentlyFocusedInput:()=>null,blurTextInput:()=>{}};`,
  'expo-crypto': `let id=0;export const randomUUID=()=> 'permission-'+(++id);`,
}
const result = await build({
  stdin: {
    contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
      import {WorkspaceContext} from '@dovo/studio-core';import {RuntimeContext} from '${mobile}runtime/connection/provider';
      import {defaultTaskHarness,taskSchema,decode,taskHarnessSchema,resolveTaskAgent} from '@dovo/protocol';
      import {ComposerSettingsControls} from '${ui}src/composer-settings-controls';
      import {HarnessFields} from '${ui}src/harness-fields';
      import {TaskDefaultSettings as DesktopDefaults} from '${ui}src/task-default-settings';
      import {AgentEditor as DesktopAgent} from '${root}packages/extension-agents/src/agent-editor';
      import {ComposerHarnessControls} from '${root}packages/extension-tasks/src/chat/composer/composer-harness-controls';
      import {AgentEditor as NativeAgent} from '${mobile}agents/agent-editor';
      import {TaskLauncherControls as NativeLauncher} from '${mobile}tasks/creation/task-launcher-controls';
      import {HarnessSettings as NativeHarness} from '${mobile}tasks/detail/harness-settings';
      import {TaskDefaultSettings as NativeDefaults} from '${mobile}runtime/preferences/task-default-settings';
      import {changeTaskHarness} from '${root}packages/extension-tasks/src/chat/composer/task-harness-selection';
      window.requests=[];window.saved=[];
      function App(){
        const initial={...defaultTaskHarness('codex'),model:'model',id:'preset',name:'Preset',...window.fixture.policy};
        const [value,setValue]=useState(initial),[supported,setSupported]=useState(window.fixture.supported),[disabled,setDisabled]=useState(window.fixture.disabled);
        const repository={id:'repo',name:'Repository',path:'/repo',branch:'main',kind:'scratch'};
        const task=decode(taskSchema,{id:'task',repositoryId:'repo',agentId:window.fixture.custom?'preset':'',harness:initial,title:'Task',status:window.fixture.running?'running':'draft',draft:'',createdAt:'2026-10-14T00:00:00Z',messages:[],files:[],example:false});
        const [storedTask,setStoredTask]=useState(task);window.task=storedTask;
        const snapshot={permissionPolicySupported:supported,workspace:{agents:[initial],repositories:[repository],tasks:[storedTask],skills:[],mcpServers:[]},questions:[],approvals:[],defaults:{harness:initial,configured:true}};
        let scopeValue={taskDefaults:window.fixture.defaults??{}};
        const inherited={taskDefaults:window.fixture.inherited??{}};
        const request=async(path,input)=>{
          window.requests.push({path,input});
          if(path==='/api/agents/settings/read')return {value:scopeValue,inherited};
          if(path==='/api/agents/settings/save'){scopeValue=input.after;window.saved.push(input.after);return {value:input.after,inherited}}
          if(path==='/api/agents/models')return {models:[],reasoning:[]};
          if(path==='/api/workspace'){window.saved.push(input.changes);return {revision:1}}
          return {};
        };
        const change=async(next)=>{setValue(next);window.changed=next;window.taskChanged=changeTaskHarness(task,[initial],decode(taskHarnessSchema,next));return true};
        const save=async(next)=>{window.saved.push(next)};
        window.value=value;window.setSupported=setSupported;window.setDisabled=setDisabled;
        const workspace={connected:!disabled,workspace:snapshot.workspace,snapshot,request,runtimes:[],flush:async()=>{},setWorkspace:update=>setStoredTask(current=>update({...snapshot.workspace,tasks:[current]}).tasks[0])};
        const runtime={connected:!disabled,snapshot,profile:{id:'runtime',name:'Runtime',connection:{address:'http://fixture',token:'fixture'}},overviews:[],call:request,callEffect:(...args)=>Effect.tryPromise(()=>request(...args)),previewTaskEffect:(_profile,_id,preview,effect)=>effect.pipe(Effect.tap(()=>Effect.sync(()=>setStoredTask(current=>({...current,...preview})))))};
        const kind=window.fixture.kind;
        return <WorkspaceContext.Provider value={workspace}><RuntimeContext.Provider value={runtime}>
          <main style={{maxWidth:kind.startsWith('native')?390:800,padding:20}}>
            {kind==='composer-harness'&&<ComposerHarnessControls task={storedTask} disabled={disabled}/>}
            {kind==='composer'&&<ComposerSettingsControls value={value} disabled={disabled} agents={[initial]} selectedAgent={window.fixture.custom?initial:undefined} onChange={change} onSelectAgent={async()=>true} onConfigure={()=>{}}/>}
            {kind==='fields'&&<HarnessFields value={value} onChange={change}/>}
            {kind==='desktop-agent'&&<DesktopAgent initial={initial} creating={false} inline computerName="Runtime" onClose={()=>{}} onSave={save}/>}
            {kind==='desktop-defaults'&&<DesktopDefaults inline scope="environment" repository={repository}/>}
            {kind==='native-agent'&&<NativeAgent original={initial} creating={false} onClose={()=>{}} onSave={save}/>}
            {kind==='native-launcher'&&<NativeLauncher selection={{key:'harness:'+value.provider,provider:value.provider,name:value.name,model:value.model,harness:value}} onChange={next=>change(next.harness)} snapshot={snapshot} repository={repository} disabled={disabled}/>}
            {kind==='native-harness'&&<NativeHarness task={storedTask} inline onClose={()=>{}}/>}
            {kind==='native-defaults'&&<NativeDefaults inline scope="environment" repository={repository}/>}
          </main>
        </RuntimeContext.Provider></WorkspaceContext.Provider>
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir: ui,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'permission-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) => {
          if (Object.hasOwn(mocks, path)) return { path, namespace: 'fixture' }
          if (['react', 'react/jsx-runtime', 'react-dom/client'].includes(path))
            return { path: require.resolve(path) }
        })
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: ui,
        }))
        builder.onLoad({ filter: /\.[jt]sx?$/ }, ({ path }) =>
          moduleMocks.has(path)
            ? { contents: moduleMocks.get(path), loader: 'tsx', resolveDir: ui }
            : undefined,
        )
      },
    },
  ],
})

const browser = await chromium.launch({ headless: true })
const errors = []
const screenshotDir = '/tmp/dovo-permission-ui-screenshots'
await mkdir(screenshotDir, { recursive: true })
async function pageFor(fixture) {
  const page = await browser.newPage({
    viewport: { width: fixture.kind.startsWith('native') ? 430 : 1100, height: 1000 },
  })
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(fixture.kind, error.message)
  })
  await page.setContent('<div id="app"></div>')
  const assets = new URL('../apps/desktop/dist/assets/', import.meta.url)
  for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(new URL(file, assets), 'utf8') })
  await page.addStyleTag({
    content:
      'body{background:#161923;color:#eee;font-family:system-ui}button{cursor:pointer}button:disabled{cursor:default}input{color:#111}',
  })
  await page.evaluate((fixture) => {
    window.fixture = { supported: true, ...fixture }
  }, fixture)
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await expandAdvanced(page)
  return page
}
async function expandAdvanced(page) {
  const more = page.getByRole('button', { name: 'More settings', exact: true })
  if (await more.count()) await more.click()
  for (const details of await page.locator('details').all()) {
    if (
      (await details.locator('summary').textContent())?.startsWith('Advanced') &&
      (await details.getAttribute('open')) === null
    )
      await details.locator('summary').click()
  }
  for (const button of await page.getByRole('button', { name: /^Advanced ·/ }).all()) {
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  }
}
async function desktopChoice(page, label, name, index = 0) {
  await expandAdvanced(page)
  await page.getByRole('button', { name: label, exact: true }).nth(index).click()
  await page.getByRole('option', { name, exact: true }).click()
}
async function nativeChoice(page, label, name, index = 0) {
  await expandAdvanced(page)
  await page.getByRole('button', { name: label, exact: true }).nth(index).click()
  await page.getByRole('button', { name, exact: true }).click()
}
async function composerChoice(page, label, name) {
  await page.getByRole('button', { name: 'Configure task permissions' }).click()
  const trigger = page.getByRole('menuitem', { name: label, exact: true })
  await trigger.focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('menuitemradio', { name, exact: true }).click()
}
try {
  // Actual composer advanced menus, custom task overrides, access changes and clear semantics.
  const composer = await pageFor({ kind: 'composer', custom: true })
  await composerChoice(composer, 'Approval policy', 'On request')
  await composerChoice(composer, 'Sandbox', 'Workspace write')
  await composer.waitForFunction(() => window.value.sandboxMode === 'workspace-write')
  await composer.getByRole('button', { name: 'Configure task permissions' }).click()
  await composer.screenshot({ path: `${screenshotDir}/composer-permissions.png` })
  await composer.keyboard.press('Escape')
  assert.equal(
    await composer.evaluate(() => window.taskChanged.agentOverrides.approvalPolicy),
    'on-request',
  )
  // Repeat selection of Full access must reset controls even when it is the underlying preset.
  await composer.getByRole('button', { name: 'Configure task permissions' }).click()
  await composer.getByRole('menuitemradio', { name: /^Full access/ }).click()
  assert.deepEqual(
    await composer.evaluate(() => [window.value.approvalPolicy, window.value.sandboxMode]),
    [undefined, undefined],
  )
  await composerChoice(composer, 'Approval policy', 'On request')
  await composerChoice(composer, 'Sandbox', 'Workspace write')
  await composer.getByRole('button', { name: 'Configure task permissions' }).click()
  await composer.getByRole('menuitemradio', { name: /Supervised/ }).click()
  assert.deepEqual(
    await composer.evaluate(() => [window.value.approvalPolicy, window.value.sandboxMode]),
    [undefined, undefined],
  )
  assert.equal(
    await composer.getByRole('button', { name: 'Configure task permissions' }).textContent(),
    'Supervised',
  )
  await composerChoice(composer, 'Approval policy', 'Inherit from access mode')
  assert.equal(
    await composer.evaluate(() => window.taskChanged.agentOverrides.approvalPolicy),
    null,
  )
  await composerChoice(composer, 'Sandbox', 'Inherit from access mode')
  assert.equal(await composer.evaluate(() => window.taskChanged.agentOverrides.sandboxMode), null)
  await composerChoice(composer, 'Sandbox', 'Read only')
  await composer.getByRole('button', { name: 'Choose agent and model' }).click()
  await composer.getByRole('button', { name: 'Claude models', exact: true }).click()
  await composer.getByRole('option', { name: /Model/ }).click()
  assert.deepEqual(
    await composer.evaluate(() => [
      window.value.provider,
      window.value.permission,
      window.value.sandboxMode ?? null,
    ]),
    ['claude', 'read-only', null],
  )
  await composer.close()

  const composerHarness = await pageFor({
    kind: 'composer-harness',
    custom: true,
    policy: { approvalPolicy: 'untrusted', sandboxMode: 'workspace-write' },
  })
  await composerChoice(composerHarness, 'Approval policy', 'Inherit from access mode')
  assert.equal(
    await composerHarness.evaluate(() => window.task.agentOverrides.approvalPolicy),
    null,
  )
  assert.equal(
    await composerHarness.evaluate(() => window.task.agentOverrides.sandboxMode),
    'workspace-write',
  )
  await composerChoice(composerHarness, 'Sandbox', 'Read only')
  assert.equal(
    await composerHarness.evaluate(() => window.task.agentOverrides.sandboxMode),
    'read-only',
  )
  await composerHarness.getByRole('button', { name: 'Choose agent and model' }).click()
  await composerHarness.getByRole('button', { name: 'Codex models', exact: true }).click()
  await composerHarness.getByRole('button', { name: 'Use Codex directly', exact: true }).click()
  await composerHarness.waitForFunction(() => window.task.agentId === '')
  assert.equal(await composerHarness.evaluate(() => window.task.harness.sandboxMode), 'read-only')
  await composerHarness.close()
  const oldComposerHarness = await pageFor({
    kind: 'composer-harness',
    supported: undefined,
    policy: { sandboxMode: 'read-only' },
  })
  await oldComposerHarness.getByRole('button', { name: 'Configure task permissions' }).click()
  await oldComposerHarness.getByRole('menuitemradio', { name: /Supervised/ }).click()
  await oldComposerHarness.waitForFunction(() => window.task.harness.permission === 'ask')
  assert.deepEqual(
    await oldComposerHarness.evaluate(() => [
      window.task.harness.permission,
      window.task.harness.sandboxMode,
    ]),
    ['ask', undefined],
  )
  await oldComposerHarness.close()

  // Preserve setup's save/provider-switch/old-runtime coverage on the shipped defaults form.
  for (const providerSwitch of [false, true]) {
    const page = await pageFor({
      kind: 'native-defaults',
      defaults: {
        harness: {
          provider: 'codex',
          model: 'model',
          permission: 'read-only',
          endpoint: '',
          instructions: '',
        },
        ...(providerSwitch ? { approvalPolicy: 'untrusted', sandboxMode: 'workspace-write' } : {}),
      },
    })
    await expandAdvanced(page)
    await page.getByRole('button', { name: 'Approval policy', exact: true }).waitFor()
    if (providerSwitch) await nativeChoice(page, 'Harness', 'Claude Code')
    else {
      await nativeChoice(page, 'Approval policy', 'On request')
      await nativeChoice(page, 'Sandbox', 'Workspace write')
    }
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 1)
    if (providerSwitch)
      assert.deepEqual(
        await page.evaluate(() => [
          window.saved[0].taskDefaults.harness.provider,
          window.saved[0].taskDefaults.permission,
          window.saved[0].taskDefaults.approvalPolicy ?? null,
          window.saved[0].taskDefaults.sandboxMode ?? null,
        ]),
        ['claude', 'read-only', null, null],
      )
    else
      assert.deepEqual(
        await page.evaluate(() => [
          window.saved[0].taskDefaults.approvalPolicy,
          window.saved[0].taskDefaults.sandboxMode,
        ]),
        ['on-request', 'workspace-write'],
      )
    await page.close()
  }
  const oldDefaults = await pageFor({
    kind: 'native-defaults',
    supported: undefined,
    defaults: { sandboxMode: 'read-only' },
  })
  await expandAdvanced(oldDefaults)
  assert.equal(
    await oldDefaults.getByRole('button', { name: 'Sandbox', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await oldDefaults.getByRole('button', { name: 'Save defaults', exact: true }).isDisabled(),
    true,
  )
  await oldDefaults.close()
  for (const kind of ['fields', 'desktop-agent']) {
    const page = await pageFor({ kind })
    await desktopChoice(page, 'Approval policy', 'Untrusted commands')
    await desktopChoice(page, 'Sandbox', 'Workspace write')
    if (kind === 'desktop-agent') {
      await page.getByRole('button', { name: 'Save configuration', exact: true }).click()
      await page.waitForFunction(() => window.saved.length === 1)
      assert.deepEqual(
        await page.evaluate(() => [window.saved[0].approvalPolicy, window.saved[0].sandboxMode]),
        ['untrusted', 'workspace-write'],
      )
    } else {
      assert.equal(await page.evaluate(() => window.value.sandboxMode), 'workspace-write')
    }
    await page.screenshot({ path: `${screenshotDir}/${kind}.png`, fullPage: true })
    await page.close()
  }
  const unsupported = await pageFor({
    kind: 'fields',
    policy: { provider: 'claude', approvalPolicy: 'untrusted', sandboxMode: 'read-only' },
  })
  assert.match(
    await unsupported.getByRole('button', { name: 'Approval policy', exact: true }).textContent(),
    /Untrusted commands.*Not supported/,
  )
  await unsupported.getByRole('button', { name: 'Sandbox', exact: true }).click()
  assert.equal(
    await unsupported
      .getByRole('option', { name: 'Read only · Not supported', exact: true })
      .isDisabled(),
    true,
  )
  await unsupported.getByRole('option', { name: 'Inherit from access mode', exact: true }).click()
  await desktopChoice(unsupported, 'Approval policy', 'Inherit from access mode')
  assert.deepEqual(
    await unsupported.evaluate(() => [
      window.value.approvalPolicy ?? null,
      window.value.sandboxMode ?? null,
    ]),
    [null, null],
  )
  await unsupported.close()

  for (const kind of [
    'composer',
    'fields',
    'desktop-agent',
    'native-agent',
    'native-launcher',
    'native-harness',
  ]) {
    const page = await pageFor({
      kind,
      supported: undefined,
      policy: { sandboxMode: 'read-only', approvalPolicy: 'on-request' },
    })
    if (kind === 'composer')
      await page.getByRole('button', { name: 'Configure task permissions' }).click()
    const role = kind === 'composer' ? 'menuitem' : 'button'
    assert.equal(
      await page.getByRole(role, { name: 'Approval policy', exact: true }).isDisabled(),
      true,
    )
    assert.equal(await page.getByRole(role, { name: 'Sandbox', exact: true }).isDisabled(), true)
    assert.ok((await page.getByText(/Update this runtime/).count()) > 0)
    if (kind === 'desktop-agent')
      assert.equal(
        await page.getByRole('button', { name: 'Save configuration', exact: true }).isDisabled(),
        true,
      )
    if (kind === 'native-agent')
      assert.equal(
        await page.getByRole('button', { name: 'Save agent', exact: true }).isDisabled(),
        true,
      )
    if (kind === 'native-harness')
      assert.equal(
        await page.getByRole('button', { name: 'Save agent & model', exact: true }).count(),
        0,
      )
    await page.close()
  }
  const running = await pageFor({
    kind: 'native-harness',
    running: true,
    policy: { sandboxMode: 'read-only' },
  })
  assert.equal(
    await running.getByRole('button', { name: 'Sandbox', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await running.getByRole('button', { name: 'Approval policy', exact: true }).isDisabled(),
    true,
  )
  await running.close()

  for (const kind of ['native-launcher', 'native-agent', 'native-harness']) {
    const page = await pageFor({ kind, custom: true })
    await nativeChoice(page, 'Approval policy', 'On request')
    await nativeChoice(page, 'Sandbox', 'Workspace write')
    if (kind === 'native-agent') {
      await page.getByRole('button', { name: 'Save agent', exact: true }).click()
      await page.waitForFunction(() => window.saved.length === 1)
      assert.equal(await page.evaluate(() => window.saved[0].sandboxMode), 'workspace-write')
    } else if (kind === 'native-harness') {
      await nativeChoice(page, 'Sandbox', 'Inherit from access mode')
      await page.waitForFunction(() => window.saved.length === 3)
      assert.equal(
        await page.evaluate(() => window.saved.at(-1).agentOverrides.after.sandboxMode),
        null,
      )
      assert.equal(
        await page.evaluate(() => window.saved.at(-1).agentOverrides.after.approvalPolicy),
        'on-request',
      )
    } else {
      await nativeChoice(page, 'Access mode', 'Supervised')
      assert.equal(await page.evaluate(() => window.value.sandboxMode), undefined)
      await nativeChoice(page, 'Sandbox', 'Inherit from access mode')
      assert.equal(await page.evaluate(() => window.value.sandboxMode ?? null), null)
    }
    await page.screenshot({ path: `${screenshotDir}/${kind}.png`, fullPage: true })
    await page.close()
  }
  // Native controls really invoke conservative provider switching, independently of pure helpers.
  for (const kind of ['native-agent', 'native-launcher']) {
    const page = await pageFor({
      kind,
      policy: { sandboxMode: 'workspace-write', approvalPolicy: 'untrusted' },
    })
    if (kind === 'native-agent') await nativeChoice(page, 'Provider', 'Claude Code')
    else {
      await page.getByRole('button', { name: 'Back to models', exact: true }).click()
      await page.getByRole('button', { name: 'Claude', exact: true }).click()
      await page.getByRole('button', { name: 'Provider default', exact: true }).click()
    }
    if (kind === 'native-agent') {
      await page.getByRole('button', { name: 'Save agent', exact: true }).click()
      await page.waitForFunction(() => window.saved.length === 1)
      assert.deepEqual(
        await page.evaluate(() => [
          window.saved[0].provider,
          window.saved[0].permission,
          window.saved[0].approvalPolicy ?? null,
          window.saved[0].sandboxMode ?? null,
        ]),
        ['claude', 'read-only', null, null],
      )
    } else {
      assert.deepEqual(
        await page.evaluate(() => [
          window.value.provider,
          window.value.permission,
          window.value.approvalPolicy ?? null,
          window.value.sandboxMode ?? null,
        ]),
        ['claude', 'read-only', null, null],
      )
    }
    await page.close()
  }
  // Offline/read-only surfaces disable the advanced selectors without erasing saved values.
  for (const kind of [
    'composer',
    'fields',
    'desktop-agent',
    'native-agent',
    'native-launcher',
    'native-harness',
  ]) {
    const page = await pageFor({
      kind,
      disabled: true,
      policy: { approvalPolicy: 'on-request', sandboxMode: 'read-only' },
    })
    if (kind === 'composer') {
      assert.equal(
        await page.getByRole('button', { name: 'Configure task permissions' }).isDisabled(),
        true,
      )
    } else {
      assert.equal(
        await page.getByRole('button', { name: 'Approval policy', exact: true }).isDisabled(),
        true,
      )
      assert.equal(
        await page.getByRole('button', { name: 'Sandbox', exact: true }).isDisabled(),
        true,
      )
    }
    assert.deepEqual(
      await page.evaluate(() => [window.value.approvalPolicy, window.value.sandboxMode]),
      ['on-request', 'read-only'],
    )
    await page.close()
  }
  const nativeUnsupported = await pageFor({
    kind: 'native-agent',
    policy: { provider: 'claude', approvalPolicy: 'untrusted', sandboxMode: 'read-only' },
  })
  await nativeUnsupported.getByRole('button', { name: 'Sandbox', exact: true }).click()
  assert.equal(
    await nativeUnsupported
      .getByRole('button', { name: 'Read only · Not supported', exact: true })
      .isDisabled(),
    true,
  )
  await nativeUnsupported
    .getByRole('button', { name: 'Inherit from access mode', exact: true })
    .click()
  await nativeChoice(nativeUnsupported, 'Approval policy', 'Inherit from access mode')
  await nativeUnsupported.getByRole('button', { name: 'Save agent', exact: true }).click()
  await nativeUnsupported.waitForFunction(() => window.saved.length === 1)
  assert.equal(
    await nativeUnsupported.evaluate(() =>
      Object.hasOwn(JSON.parse(JSON.stringify(window.saved[0])), 'sandboxMode'),
    ),
    false,
  )
  await nativeUnsupported.close()

  for (const kind of ['desktop-defaults', 'native-defaults']) {
    const page = await pageFor({
      kind,
      defaults: {
        harness: {
          provider: 'codex',
          model: '',
          permission: 'full-access',
          endpoint: '',
          instructions: '',
        },
      },
    })
    await expandAdvanced(page)
    await page.getByRole('button', { name: 'Approval policy', exact: true }).first().waitFor()
    const choose = kind === 'desktop-defaults' ? desktopChoice : nativeChoice
    await choose(page, 'Approval policy', 'On request')
    await choose(page, 'Sandbox', 'Read only')
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 1)
    assert.deepEqual(
      await page.evaluate(() => [
        window.saved[0].taskDefaults.approvalPolicy,
        window.saved[0].taskDefaults.sandboxMode,
      ]),
      ['on-request', 'read-only'],
    )
    await choose(page, 'Approval policy', 'Inherit from access mode')
    await choose(page, 'Sandbox', 'Inherit from access mode')
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 2)
    assert.equal(
      await page.evaluate(() =>
        Object.hasOwn(JSON.parse(JSON.stringify(window.saved[1].taskDefaults)), 'sandboxMode'),
      ),
      false,
    )
    await choose(page, 'Approval policy', 'On request')
    await choose(page, 'Sandbox', 'Workspace write')
    if (kind === 'desktop-defaults') {
      await page.getByRole('combobox', { name: 'Provider', exact: true }).click()
      await page.getByRole('option', { name: 'Claude Code', exact: true }).click()
    } else await nativeChoice(page, 'Harness', 'Claude Code')
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 3)
    assert.deepEqual(
      await page.evaluate(() => [
        window.saved[2].taskDefaults.permission,
        window.saved[2].taskDefaults.harness.provider,
        window.saved[2].taskDefaults.approvalPolicy ?? null,
        window.saved[2].taskDefaults.sandboxMode ?? null,
      ]),
      ['read-only', 'claude', null, null],
    )
    await page.screenshot({ path: `${screenshotDir}/${kind}.png`, fullPage: true })
    await page.close()
    const old = await pageFor({
      kind,
      supported: undefined,
      defaults: { sandboxMode: 'read-only' },
    })
    await old.getByRole('button', { name: 'Approval policy', exact: true }).waitFor()
    assert.equal(await old.getByRole('button', { name: 'Sandbox', exact: true }).isDisabled(), true)
    assert.ok((await old.getByText(/Update this runtime/).count()) > 0)
    if (kind === 'desktop-defaults') {
      await old.getByRole('combobox', { name: 'Access mode', exact: true }).click()
      await old.getByRole('option', { name: 'Supervised', exact: true }).click()
    } else await nativeChoice(old, 'Access mode', 'Supervised')
    assert.equal(
      await old.getByRole('button', { name: 'Save defaults', exact: true }).isDisabled(),
      true,
    )
    assert.equal(await old.evaluate(() => window.saved.length), 0)
    await old.close()
  }
  // A master preset resets inherited controls explicitly. Editing one dimension must not
  // resurrect a cleared restriction on the other dimension.
  for (const kind of ['desktop-defaults', 'native-defaults']) {
    const page = await pageFor({
      kind,
      inherited: { permission: 'ask', approvalPolicy: 'untrusted', sandboxMode: 'read-only' },
    })
    if (kind === 'desktop-defaults') {
      await page.getByRole('combobox', { name: 'Access mode', exact: true }).click()
      await page.getByRole('option', { name: 'Full access', exact: true }).click()
    } else await nativeChoice(page, 'Access mode', 'Full access')
    await expandAdvanced(page)
    const choose = kind === 'desktop-defaults' ? desktopChoice : nativeChoice
    await choose(page, 'Approval policy', 'On request')
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 1)
    assert.deepEqual(
      await page.evaluate(() => [
        window.saved[0].taskDefaults.approvalPolicy,
        window.saved[0].taskDefaults.sandboxMode,
      ]),
      ['on-request', null],
    )
    await choose(page, 'Sandbox', 'Inherit (Read only)')
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 2)
    assert.equal(await page.evaluate(() => window.saved[1].taskDefaults.sandboxMode), undefined)
    await page.getByRole('button', { name: 'Reset to access mode', exact: true }).first().click()
    await page.getByRole('button', { name: 'Save defaults', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 3)
    assert.deepEqual(
      await page.evaluate(() => [
        window.saved[2].taskDefaults.approvalPolicy,
        window.saved[2].taskDefaults.sandboxMode,
      ]),
      [null, null],
    )
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log(
    'Permission policies: actual desktop/native composer, agent and scoped defaults select, carry, clear, conservative provider switch, unsupported and legacy-runtime guards passed.',
  )
  console.log(`Screenshots: ${screenshotDir}`)
} finally {
  await browser.close()
}
