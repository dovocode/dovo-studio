import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { chromium } from './browser/harness.mjs'
const webRequire = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const mocks = {
  '../screens/settings-theme': 'export const useInsideSettings=()=>false;',
  '../screens/settings-group': 'export const SettingsGroup=({children})=>children;',
  '../../ui/layout/sheet': `export const Sheet=({title,children,onClose})=><section>{title&&<h2>{title}</h2>}{children}</section>;`,
  'expo-router': `export const router={navigate:()=>{}};`,
  '../ui/content/format-date': `export const formatDateTime=value=>value;`,
  '../ui/controls/pill': `export const Pill=({label,onPress})=><button onClick={onPress}>{label}</button>;`,
  '../screens/settings-controls': `export {Choice as SettingsChoice} from '../ui/controls/choice';export {Field as SettingsField} from '../ui/controls/field';export {Action as SettingsAction} from '../ui/controls/action';`,
  'react-native': `const css=value=>{const s=Object.assign({},...[value??{}].flat());if(s.paddingHorizontal!==undefined){s.paddingLeft=s.paddingRight=s.paddingHorizontal;delete s.paddingHorizontal}if(s.paddingVertical!==undefined){s.paddingTop=s.paddingBottom=s.paddingVertical;delete s.paddingVertical}return s};export const ScrollView=({children,style,contentContainerStyle,accessibilityLabel,horizontal})=><div aria-label={accessibilityLabel} style={{minHeight:0,minWidth:0,overflow:'auto',...css(style)}}><div style={{display:'flex',flexDirection:horizontal?'row':'column',width:horizontal?'max-content':undefined,...css(contentContainerStyle)}}>{children}</div></div>;export const View=({children,style,accessibilityLabel,accessibilityRole})=><div role={accessibilityRole} aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',boxSizing:'border-box',...css(style)}}>{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState,style})=><button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel} role={accessibilityRole} aria-expanded={accessibilityState?.expanded} aria-selected={accessibilityRole==='tab'?!!accessibilityState?.selected:undefined} aria-pressed={accessibilityRole==='button'&&accessibilityState?.selected!==undefined?!!accessibilityState.selected:undefined} style={{display:'flex',textAlign:'left',fontFamily:'inherit',border:0,boxSizing:'border-box',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;export const Alert={alert:()=>{}};export const AppState={currentState:'active',addEventListener:()=>({remove:()=>{}})};`,
  '@react-native-async-storage/async-storage': `export default {getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>localStorage.setItem(key,value)};`,
  'expo-crypto': `export const CryptoDigestAlgorithm={SHA256:'SHA-256'};export const digestStringAsync=async(_,text)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');`,
  '../runtime/connection/provider': `import {createContext,useContext} from 'react';export const Context=createContext(null);export const useRuntime=()=>useContext(Context);export const useRuntimeSelector=select=>select(useContext(Context));`,
  '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../runtime/preferences/app-preferences': `export const useMobilePreferences=()=>({globalModelPreferences:{},globalModelPreferencesUpdatedAt:0});export const updateMobilePreferences=()=>{};`,
  '../ui/content/text': `export const Text=({children,style})=>{const s=Object.assign({},...[style??{}].flat());if(typeof s.lineHeight==='number')s.lineHeight=s.lineHeight+'px';return <span style={s}>{children}</span>};`,
  '../ui/controls/choice': `export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  '../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  './harness-icon': `export const HarnessIcon=()=>null;`,
  '../ui/controls/field': `export const SearchField=({label,value,onChangeText,placeholder,onSubmitEditing,autoFocus})=><input autoFocus={autoFocus} placeholder={placeholder} aria-label={label} value={value} onKeyDown={event=>event.key==='Enter'&&onSubmitEditing?.()} onChange={event=>onChangeText(event.target.value)}/>;export const Field=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;`,
  '../ui/controls/icon': `export const Icon=()=>null;`,
  '../ui/theme': `export const useTheme=()=>({styles:{muted:{color:'#a1a1aa'},error:{color:'#f66'}},colors:{text:'#fafafa',muted:'#a1a1aa',border:'#333',selection:'#303036',accent:'#8bd5ff'}});`,
}
const built = await build({
  alias: {
    react: dirname(webRequire.resolve('react/package.json')),
    'react-dom': dirname(webRequire.resolve('react-dom/package.json')),
  },
  stdin: {
    contents: `
import {useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {defaultTaskHarness,decode,taskSchema,resolveTaskAgent} from '@dovo/protocol';import {Effect} from 'effect';import {HarnessSettings} from './src/tasks/detail/harness-settings.tsx';import {ModelSettings} from './src/agents/model-settings.tsx';import {Context} from '../runtime/connection/provider';import {ConnectionPill} from './src/runtime/connection/connection-status.tsx';import {optimisticTaskEffect,optimisticTaskConfirmed,previewTasks} from './src/runtime/state/optimistic-tasks.ts';
window.requests=[];window.finishes=[];
const readRuntime=async(profile,path,input)=>path==='/api/agents/models/cached'?null:new Promise(resolve=>{window.requests.push({host:profile.id,path,input});window.finishes.push(resolve)});
function App(){
 const[turn,setTurn]=useState(undefined);window.turn=turn;window.openTurn=()=>{setTurn(null);setTask(old=>({...old,status:'running',messages:[{id:'first',role:'user',text:'Started'}]}));setEditing(true)};
 const[queueStatus,setQueueStatus]=useState({pending:0,error:null});window.queueStatus=setQueueStatus;
 const[task,setTask]=useState(null),[editing,setEditing]=useState(false),[pending,setPending]=useState([]),[revision,setRevision]=useState(1);
 window.openTask=()=>{if(!task)setTask(decode(taskSchema,{id:'task',repositoryId:'repo',agentId:'',title:'Task',status:'draft',createdAt:'2026-09-23T10:00:00Z',messages:[],files:[],draft:'',example:false,harness:defaultTaskHarness('codex')}));setEditing(true)};
 const[host,setHost]=useState('one');const[agent,setAgent]=useState({...defaultTaskHarness('codex'),id:'agent',name:'Agent',model:''});const[online,setOnline]=useState(true);
 window.host=setHost;window.harness=provider=>setAgent({...defaultTaskHarness(provider),id:'agent',name:'Agent',model:''});window.online=setOnline;
 const profile={id:host,name:host,connection:{address:'http://'+host,token:'private-token'}};
 const snapshot={permissionPolicySupported:true,fullTurnSettingsSupported:true,smartModelSelectionEnabled:true,revision,runtimeInstanceId:host,defaults:{},workspace:{agents:[],repositories:[],tasks:task?[task]:[]},acpInstallations:[]};
 const entry={profile,snapshot};const visible=previewTasks(entry,pending).snapshot.workspace.tasks[0];window.visibleTask=visible;window.rawTask=task;
 window.publishTask=(nextRevision,nextTask)=>{setRevision(nextRevision);if(nextTask)setTask(nextTask)};
 useEffect(()=>setPending(items=>{const next=items.filter(item=>!optimisticTaskConfirmed(item,entry,items));return next.length===items.length?items:next}),[task,revision]);
 const value={profile,ready:true,overviews:[{...entry,connected:online}],mutationStatus:()=>queueStatus,refreshAll:async()=>{},connected:online,readRuntime,snapshot,previewTaskEffect:(owner,taskId,changes,request)=>optimisticTaskEffect({id:Symbol(),connection:owner.connection,taskId,changes,runtimeInstanceId:host},setPending,request),callEffect:(path,input,schema,method)=>Effect.tryPromise({try:()=>{if(path==='/api/agents/models/preference'){const result={modelPreferences:{[input.key]:{favorite:input.favorite,disabled:false}}};return window.deferPreference?new Promise(resolve=>{window.finishPreference=()=>resolve(result)}):Promise.resolve(result)}if(path==='/api/workspace'){if(method!=='PATCH')throw Error('Workspace changes require PATCH');const wire=JSON.parse(JSON.stringify(input));decode(taskSchema,{...task,...Object.fromEntries(Object.entries(wire.changes).map(([key,change])=>[key,change.after??undefined]))})}window.saved={path,input,method};return new Promise((resolve,reject)=>{window.finishSave=fail=>fail?reject(new Error('Model save rejected')):resolve({revision:revision+1,runtimeInstanceId:host})})},catch:error=>error}),refresh:async()=>{}};
 return <Context.Provider value={value}>{task?<><span data-selected-model>{resolveTaskAgent(visible,[])?.model||'Default'}</span>{editing&&<HarnessSettings task={visible} turn={turn!==undefined?{value:turn,onChange:setTurn}:undefined} onClose={()=>setEditing(false)}/>}</>:<ModelSettings agent={agent} onChange={setAgent}/>}<ConnectionPill/></Context.Provider>
};createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: fileURLToPath(new URL('../apps/mobile/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'native-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          if (path === './provider' && importer.endsWith('/connection-status.tsx'))
            return { path: '../runtime/connection/provider', namespace: 'native-environment' }
          const canonical = path.startsWith('../../') ? path.slice(3) : path
          const mocked = Object.hasOwn(mocks, path) ? path : canonical
          return Object.hasOwn(mocks, mocked)
            ? { path: mocked, namespace: 'native-environment' }
            : undefined
        })
        builder.onLoad({ filter: /.*/, namespace: 'native-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
          loader: 'tsx',
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('https://dovo.test/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const waitRequests = (count) =>
    page.waitForFunction((count) => window.requests?.length === count, count)
  const finish = (index, catalog) =>
    page.evaluate(({ index, catalog }) => window.finishes[index](catalog), { index, catalog })
  const catalog = (id, name, harness) => ({
    models: [{ id, name }],
    reasoning: [],
    ...(harness ? { harness } : {}),
  })
  await waitRequests(1)
  await page.evaluate(() => window.harness('opencode'))
  await waitRequests(2)
  await finish(0, catalog('gpt-5.1-sol', 'GPT-5.1 Sol'))
  if (await page.getByRole('option', { name: 'GPT-5.1 Sol', exact: true }).count())
    throw new Error('Late Codex response leaked into OpenCode')
  await finish(
    1,
    catalog('openai/custom', 'Host Custom', { name: 'OpenCode v2', generation: 'v2' }),
  )
  await page
    .getByRole('option', { name: 'Host Custom', exact: true })
    .waitFor({ state: 'attached' })
  await page.getByText('OpenCode v2 · Models from this computer', { exact: true }).waitFor()
  await page.evaluate(() => window.host('two'))
  await waitRequests(3)
  if (await page.getByRole('option', { name: 'Host Custom', exact: true }).count())
    throw new Error('Previous host catalogue remained in the picker')
  await finish(
    2,
    catalog('local/custom', 'Other Host Model', { name: 'OpenCode v1', generation: 'v1' }),
  )
  await page
    .getByRole('option', { name: 'Other Host Model', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.host('one'))
  await page
    .getByRole('option', { name: 'Host Custom', exact: true })
    .waitFor({ state: 'attached' })
  if ((await page.evaluate(() => window.requests.length)) !== 3)
    throw new Error('Returning to a cached harness rediscovered its models')
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click()
  await waitRequests(4)
  if (!(await page.evaluate(() => window.requests[3].input.refresh)))
    throw new Error('Refresh did not bypass the host cache')
  await finish(
    3,
    catalog('openai/custom', 'Updated Host Model', { name: 'OpenCode v2', generation: 'v2' }),
  )
  await page
    .getByRole('option', { name: 'Updated Host Model', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.online(false))
  await page
    .getByRole('option', { name: 'Updated Host Model', exact: true })
    .waitFor({ state: 'attached' })
  const stored = await page.evaluate(() => localStorage.getItem('dovo.model-catalogs.v2'))
  if (!stored || stored.includes('private-token'))
    throw new Error('Persistent model cache contains credentials or is missing')
  await page.reload()
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page
    .getByRole('option', { name: 'GPT-5.1 Sol', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.harness('opencode'))
  await page
    .getByRole('option', { name: 'Updated Host Model', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.harness('hermes'))
  await waitRequests(1)
  const hermesRequest = await page.evaluate(() => window.requests[0].input)
  if (hermesRequest.provider !== 'hermes')
    throw new Error('Hermes model discovery used another provider')
  await finish(0, catalog('openrouter:anthropic/claude-sonnet-4.6', 'Hermes Sonnet'))
  await page
    .getByRole('option', { name: 'Hermes Sonnet', exact: true })
    .waitFor({ state: 'attached' })
  await page
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption('openrouter:anthropic/claude-sonnet-4.6')
  await page.evaluate(() => window.online(false))
  await page
    .getByRole('option', { name: 'Hermes Sonnet', exact: true })
    .waitFor({ state: 'attached' })
  await page.evaluate(() => window.online(true))
  for (const [provider, id, name] of [
    ['copilot', 'gpt-example', 'Copilot Model'],
    ['muse', JSON.stringify({ providerId: 'meta', modelId: 'example' }), 'Muse Model'],
    ['grok', 'grok-example', 'Grok Model'],
    [
      'cursor',
      JSON.stringify({ id: 'cursor-example', params: [{ id: 'effort', value: 'low' }] }),
      'Cursor Model',
    ],
  ]) {
    const before = await page.evaluate(() => window.requests.length)
    await page.evaluate((provider) => window.harness(provider), provider)
    await waitRequests(before + 1)
    const request = await page.evaluate((index) => window.requests[index].input, before)
    if (request.provider !== provider)
      throw new Error(`${provider} discovered through another provider`)
    const high = provider === 'cursor' ? JSON.stringify({ id: 'effort', value: 'high' }) : 'high'
    await finish(before, {
      models: [
        { id, name, ...(provider === 'grok' ? {} : { reasoning: [{ id: high, name: 'High' }] }) },
      ],
      reasoning: [{ id: high, name: 'High' }],
    })
    await page.getByRole('option', { name, exact: true }).waitFor({ state: 'attached' })
    await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption(id)
    if (provider === 'grok') {
      await waitRequests(before + 2)
      const selected = await page.evaluate((index) => window.requests[index].input, before + 1)
      if (selected.model !== id) throw new Error('Grok reasoning discovery lost the selected model')
      await finish(before + 1, {
        models: [{ id, name }],
        reasoning: [{ id: high, name: 'High' }],
      })
    }
    await page.getByRole('combobox', { name: 'Reasoning level', exact: true }).selectOption(high)
    await page.evaluate(() => window.online(false))
    await page.getByRole('option', { name, exact: true }).waitFor({ state: 'attached' })
    await page.evaluate(() => window.online(true))
  }
  // Exercise the task editor and its real availability hook, not only local picker state.
  const beforeTask = await page.evaluate(() => window.requests.length)
  await page.evaluate(() => window.openTask())
  await page.waitForFunction(() =>
    window.requests.some((request) => request.path === '/api/agents/availability'),
  )
  const availabilityIndex = await page.evaluate(() =>
    window.requests.findIndex((request) => request.path === '/api/agents/availability'),
  )
  await finish(availabilityIndex, [])
  await page.waitForFunction((count) => window.requests.length >= count, beforeTask + 2)
  const modelIndex = await page.evaluate(() =>
    window.requests.findLastIndex((request) => request.path === '/api/agents/models'),
  )
  await finish(modelIndex, {
    models: [
      { id: 'task-model', name: 'Task Model', reasoning: [{ id: 'high', name: 'High' }] },
      {
        id: 'openrouter/anthropic/claude-sonnet-4.6-extended',
        name: 'Claude Sonnet 4.6 Extended Thinking via OpenRouter',
      },
      { id: 'openai/shared-model', name: 'Shared Model', description: 'Fast general model' },
      { id: 'azure/shared-model', name: 'Shared Model', description: 'Fast general model' },
    ],
    reasoning: [],
  })
  if (await page.getByRole('combobox', { name: 'Reasoning level', exact: true }).count())
    throw new Error('Secondary settings clutter the initial picker')
  // The selection mode leads the picker instead of hiding under More settings.
  if (
    !(await page
      .getByRole('combobox', { name: 'Model selection', exact: true })
      .evaluate(
        (mode) =>
          !!(
            mode.compareDocumentPosition(
              document.querySelector('[aria-label="Search harnesses and models"]'),
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ))
  )
    throw new Error('Model selection mode was not offered before the model picker')
  await page.getByText('Codex models on one.', { exact: true }).waitFor()
  // IDs that only restate the name are omitted; distinct ones remain.
  if (
    await page
      .getByRole('button', { name: 'Task Model', exact: true })
      .getByText('task-model', { exact: true })
      .count()
  )
    throw new Error('A model ID that repeats its name was shown')
  await page.addStyleTag({
    content:
      'body{margin:12px;background:#1c1c1e;color:#fafafa;font-family:system-ui}button{background:transparent;color:inherit}input{width:100%;min-width:0;box-sizing:border-box;background:transparent;border:0;border-bottom:1px solid #444;color:inherit;padding:10px;font-size:14px}button{font-size:14px}h2{font-size:18px}',
  })
  const longModel = 'Claude Sonnet 4.6 Extended Thinking via OpenRouter'
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 })
    for (const [role, label] of [
      ['tab', 'Models'],
      ['tab', 'Favorites'],
      ['tab', 'Agents'],
      ['button', 'Choose provider'],
      ['button', longModel],
    ]) {
      const visible = await page
        .getByRole(role, { name: label, exact: true })
        .evaluate((button) => {
          const text = Array.from(button.querySelectorAll('span')).find(
            (node) =>
              node.textContent ===
              (button.getAttribute('aria-label') === 'Choose provider'
                ? 'Codex'
                : button.getAttribute('aria-label')),
          )
          return (
            !!text &&
            text.getBoundingClientRect().width > 20 &&
            text.getBoundingClientRect().height > 8
          )
        })
      if (!visible) throw new Error(`Picker navigation label ${label} collapsed at ${width}px`)
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
      throw new Error(`Picker overflowed at ${width}px`)
    // Model rows use the full sheet width instead of sharing it with a harness rail.
    const row = await page
      .getByRole('button', { name: longModel, exact: true })
      .evaluate((button) => button.getBoundingClientRect().width)
    if (row < width - 24 - 44 - 8)
      throw new Error(`Model rows were cramped to ${row}px at ${width}px`)
    const star = await page
      .getByRole('button', { name: 'Favorite Task Model', exact: true })
      .boundingBox()
    if (!star || star.width < 44 || star.height < 44)
      throw new Error(`Favorite target was smaller than 44px at ${width}px`)
  }
  const providerControl = page.getByRole('button', { name: 'Choose provider', exact: true })
  await providerControl.click()
  await page.screenshot({ path: '/tmp/dovo-mobile-provider-picker.png', fullPage: true })
  await page.getByRole('textbox', { name: 'Search providers', exact: true }).fill('not-a-provider')
  await page.getByText('No matching providers.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back to models', exact: true }).click()
  await page.getByRole('button', { name: 'Task Model', exact: true }).waitFor()
  if (await page.evaluate(() => !!window.saved))
    throw new Error('Browsing providers changed the selected model')
  // Identical catalogue names and descriptions stay distinguishable by model ID.
  for (const id of ['openai/shared-model', 'azure/shared-model'])
    if (
      !(await page
        .getByRole('button', { name: `Shared Model · ${id.split('/')[0]}` })
        .getByText(id, { exact: true })
        .count())
    )
      throw new Error(`Duplicate model ${id} did not show its identifier`)
  // Rows flow in the caller's sheet instead of a nested fixed-height scroll area.
  if (
    await page.getByLabel('Available models', { exact: true }).evaluate((list) => {
      const style = getComputedStyle(list)
      return style.overflowY !== 'visible' || style.maxHeight !== 'none'
    })
  )
    throw new Error('Model list nested its own scroll area inside the sheet')
  if (
    (await page.getByRole('tab', { name: 'Models', exact: true }).getAttribute('aria-selected')) !==
    'true'
  )
    throw new Error('Current picker tab was not exposed as selected')
  await page.screenshot({ path: '/tmp/dovo-mobile-picker.png', fullPage: true })
  await page.getByRole('tab', { name: 'Favorites', exact: true }).click()
  await page.getByText('No favorite models for this harness.', { exact: true }).waitFor()
  await page
    .getByText('Codex favorites saved on one, shared by all its tasks.', { exact: true })
    .waitFor()
  await page.getByRole('tab', { name: 'Agents', exact: true }).click()
  await page.getByText('No saved agents. Create one in Settings.', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Models', exact: true }).click()
  await page.getByRole('button', { name: 'Favorite Task Model', exact: true }).click()
  await page.getByRole('button', { name: 'Unfavorite Task Model', exact: true }).waitFor()
  if (await page.evaluate(() => !!window.saved))
    throw new Error('Favoriting changed the selected model')
  await page.getByRole('tab', { name: 'Favorites', exact: true }).click()
  await page.getByRole('button', { name: 'Task Model', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Unfavorite Task Model', exact: true }).click()
  await page.getByText('No favorite models for this harness.', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Models', exact: true }).click()
  // An unknown ID can be used straight from search.
  await page.getByRole('textbox', { name: 'Search harnesses and models' }).fill('my-custom-id')
  await page.getByRole('button', { name: 'Use custom model my-custom-id', exact: true }).waitFor()
  if (await page.getByText('No matching models.', { exact: true }).count())
    throw new Error('Search offered no way to use an unknown model ID')
  await page.getByRole('textbox', { name: 'Search harnesses and models' }).fill('missing model')
  await page.getByText('No matching models.', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Search harnesses and models' }).fill('Task Model')
  await page.getByRole('button', { name: 'Task Model', exact: true }).waitFor()
  if (await page.getByRole('button', { name: longModel, exact: true }).count())
    throw new Error('Model search did not filter the list')
  // A search that identifies one model can be chosen from the keyboard.
  await page.getByRole('textbox', { name: 'Search harnesses and models' }).press('Enter')
  await page.waitForFunction(
    () => window.saved?.input.changes.harness?.after.model === 'task-model',
  )
  // While the save is pending the picker is disabled, but browsing and favorites stay usable.
  if (!(await page.getByRole('button', { name: 'Task Model', exact: true }).isDisabled()))
    throw new Error('A disabled picker still allowed changing the model')
  await page.getByRole('button', { name: 'Favorite Task Model', exact: true }).click()
  await page.getByRole('tab', { name: 'Favorites', exact: true }).click()
  await page.getByRole('button', { name: 'Unfavorite Task Model', exact: true }).click()
  await page.getByText('No favorite models for this harness.', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'Models', exact: true }).click()
  await page.getByRole('button', { name: 'Choose provider', exact: true }).click()
  await page.getByRole('button', { name: 'Codex', exact: true }).click()
  if (await page.evaluate(() => window.saved.input.changes.harness.after.model !== 'task-model'))
    throw new Error('Browsing a disabled picker changed the pending selection')
  if (await page.getByRole('button', { name: 'Save agent & model', exact: true }).count())
    throw new Error('Picker still requires manual save')
  await page.evaluate(() => window.finishSave(false))
  await page.getByRole('button', { name: 'More settings', exact: true }).waitFor()
  await page.getByRole('button', { name: 'More settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'Reasoning level', exact: true }).selectOption('high')
  await page.waitForFunction(() => window.saved?.input.changes.harness?.after.reasoning === 'high')
  await page.waitForFunction(() => window.saved)
  const saved = await page.evaluate(() => window.saved)
  if (
    saved.method !== 'PATCH' ||
    saved.input.changes.harness.after.model !== 'task-model' ||
    saved.input.changes.harness.after.reasoning !== 'high'
  )
    throw new Error(
      'Task model/reasoning selection was not saved after failed availability discovery',
    )
  await page.waitForFunction(() => window.visibleTask?.harness?.model === 'task-model')
  await page.evaluate(() => window.finishSave(false))
  await page
    .getByRole('button', { name: 'Save agent & model', exact: true })
    .waitFor({ state: 'detached' })
  if ((await page.locator('[data-selected-model]').textContent()) !== 'task-model')
    throw new Error(
      'Closing model settings reverted a committed model before snapshot confirmation',
    )
  await page.evaluate(() => window.publishTask(1, { ...window.rawTask }))
  await page.waitForFunction(() => window.visibleTask?.harness?.model === 'task-model')
  await page.evaluate(() =>
    window.publishTask(2, {
      ...window.rawTask,
      harness: window.saved.input.changes.harness.after,
      harnessCustomized: true,
    }),
  )
  await page.waitForFunction(
    () =>
      window.rawTask?.harness?.model === 'task-model' &&
      window.visibleTask?.harness?.model === 'task-model',
  )
  await page.evaluate(() => window.openTask())
  await page.getByRole('button', { name: 'Back to models', exact: true }).click()
  await page.getByLabel('Selected on one: Codex, Task Model', { exact: true }).waitFor()
  if (
    (await page
      .getByRole('button', { name: 'Task Model', exact: true })
      .getAttribute('aria-pressed')) !== 'true'
  )
    throw new Error('The selected model row was not marked as selected')
  // Custom models are reachable from the keyboard: open, type into the focused field, submit.
  await page.getByRole('button', { name: 'Custom model…', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('textbox', { name: 'Custom model ID', exact: true }).waitFor()
  if (
    !(await page
      .getByRole('textbox', { name: 'Custom model ID', exact: true })
      .evaluate((field) => field === document.activeElement))
  )
    throw new Error('Opening a custom model did not focus its field')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('rejected-model')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.visibleTask?.harness?.model === 'rejected-model')
  // A custom ID outside the catalogue is named by its ID rather than a stale catalogue name.
  await page.getByLabel('Selected on one: Codex, rejected-model', { exact: true }).waitFor()
  await page.evaluate(() => window.finishSave(true))
  await page.getByText('Model save rejected', { exact: true }).waitFor()
  await page.waitForFunction(() => window.visibleTask?.harness?.model === 'task-model')
  if (
    (await page.getByRole('textbox', { name: 'Custom model ID', exact: true }).inputValue()) !==
    'rejected-model'
  )
    throw new Error('Rejected save lost the selected model needed for retry')
  await page.evaluate(() => window.queueStatus({ pending: 1, error: null }))
  await page.waitForTimeout(2700)
  if (await page.getByRole('button', { name: 'Saved actions · Review', exact: true }).count())
    throw new Error('A normally syncing edit displayed connection recovery')
  await page.evaluate(() => window.queueStatus({ pending: 1, error: 'Connection lost' }))
  await page.getByRole('button', { name: 'Saved actions · Review', exact: true }).click()
  await page.getByRole('heading', { name: 'Connection', exact: true }).waitFor()
  await page.evaluate(() => window.queueStatus({ pending: 0, error: null }))
  await page
    .getByRole('heading', { name: 'Connection', exact: true })
    .waitFor({ state: 'detached' })
  // Automatic modes must use the workspace mutation contract and stay selected
  // while the confirming snapshot is still in flight.
  await page.getByRole('button', { name: 'More settings', exact: true }).click()
  const mode = page.getByRole('combobox', { name: 'Model selection', exact: true })
  await mode.selectOption('smart')
  await page.waitForFunction(() => window.visibleTask?.modelSelection === 'smart')
  await page.waitForFunction(() => window.saved.input.changes.modelSelection?.after === 'smart')
  if ((await page.evaluate(() => window.saved.method)) !== 'PATCH')
    throw new Error('Maestro did not use PATCH')
  await page.evaluate(() => window.finishSave(false))
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="Model selection"]').disabled,
  )
  if ((await mode.inputValue()) !== 'smart') throw new Error('Maestro reverted before confirmation')
  if (await page.getByRole('button', { name: 'Save agent & model', exact: true }).count())
    throw new Error('Manual save can overwrite Maestro')
  await page.evaluate(() =>
    window.publishTask(3, {
      ...window.rawTask,
      ...Object.fromEntries(
        Object.entries(window.saved.input.changes).map(([key, value]) => [
          key,
          value.after ?? undefined,
        ]),
      ),
    }),
  )
  const difficulty = page.getByRole('combobox', { name: 'Difficulty', exact: true })
  await difficulty.selectOption('high')
  await page.waitForFunction(() => window.visibleTask?.modelSelectionDifficulty === 'high')
  await page.evaluate(() => window.finishSave(true))
  await page.getByText('Model save rejected', { exact: true }).waitFor()
  await page.waitForFunction(() => !window.visibleTask?.modelSelectionDifficulty)
  if ((await mode.inputValue()) !== 'smart')
    throw new Error('Failed difficulty save cleared Maestro')
  await mode.selectOption('auto')
  await page.waitForFunction(() => window.visibleTask?.modelSelection === 'auto')
  await page.evaluate(() => window.finishSave(false))
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="Model selection"]').disabled,
  )
  await page.evaluate(() => window.online(false))
  if (!(await mode.isDisabled())) throw new Error('Offline mode changes remained enabled')
  await page.evaluate(() => window.online(true))
  await mode.selectOption('fixed')
  await page.waitForFunction(() => window.saved.input.changes.modelSelection?.after === null)
  await page.evaluate(() => window.finishSave(false))
  await mode.waitFor({ state: 'detached' })
  await page.evaluate(() => window.openTask())
  await page.getByRole('button', { name: 'More settings', exact: true }).click()
  await mode.waitFor()
  if ((await mode.inputValue()) !== 'fixed') throw new Error('Fixed mode reverted after reopening')
  // Favorites belong to one computer: a late save from the previous computer must not leak into
  // another computer whose defaults happen to be identical (here both are empty).
  await page.evaluate(() =>
    window.publishTask(4, {
      ...window.rawTask,
      modelSelection: undefined,
      modelSelectionDifficulty: undefined,
    }),
  )
  await page.getByRole('button', { name: 'Back to models', exact: true }).click()
  await page.evaluate(() => {
    window.deferPreference = true
  })
  await page.getByRole('button', { name: 'Favorite Task Model', exact: true }).click()
  await page.waitForFunction(() => !!window.finishPreference)
  const beforeHost = await page.evaluate(() => window.requests.length)
  await page.evaluate(() => window.host('two'))
  await page.waitForFunction(
    (count) =>
      window.requests
        .slice(count)
        .some((request) => request.host === 'two' && request.path === '/api/agents/models'),
    beforeHost,
  )
  for (const [index, request] of (
    await page.evaluate((count) => window.requests.slice(count), beforeHost)
  ).entries())
    await finish(
      beforeHost + index,
      request.path === '/api/agents/models'
        ? { models: [{ id: 'task-model', name: 'Task Model' }], reasoning: [] }
        : [],
    )
  await page.getByText('Codex models on two.', { exact: true }).waitFor()
  await page.evaluate(() => window.finishPreference())
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: 'Task Model', exact: true }).waitFor()
  const star = page.getByRole('button', { name: 'Favorite Task Model', exact: true })
  if (await page.getByRole('button', { name: 'Unfavorite Task Model', exact: true }).count())
    throw new Error('A late favorite save from the previous computer leaked into this computer')
  if (await star.isDisabled())
    throw new Error("The previous computer's pending favorite save blocked this computer")

  const defaultsBeforeTurn = await page.evaluate(() => window.rawTask.harness)
  await page.evaluate(() => window.openTurn())
  const more = page.getByRole('button', { name: 'More settings', exact: true })
  await more.click()
  const access = page.getByRole('combobox', { name: 'Access mode', exact: true })
  if (await access.isDisabled()) throw new Error('Next-turn permissions are disabled during a run')
  await access.selectOption('full-access')
  await page.waitForFunction(() => window.turn?.harness.permission === 'full-access')
  if (
    JSON.stringify(await page.evaluate(() => window.rawTask.harness)) !==
    JSON.stringify(defaultsBeforeTurn)
  )
    throw new Error('Next-turn settings changed the thread defaults')
  await page.getByRole('button', { name: 'Use thread defaults', exact: true }).click()
  await page.waitForFunction(() => window.turn === null)
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Mobile picker: host and harness switches, late responses, cache reuse, real refresh, offline names, Hermes/Copilot/Grok/Muse/Cursor model selection, reasoning, OpenCode v1/v2 labels, and task model/reasoning saves with unavailable provider discovery passed.',
  )
} finally {
  await browser.close()
}
