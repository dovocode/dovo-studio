import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const desktop = `${root}/packages/extension-tasks/src`
const mobile = `${root}/apps/mobile/src`
const ui = `${root}/packages/studio-ui/src`
const screenshots = `${root}/docs/screenshots/do`

// This is an API fixture, not a second scheduler. Tests explicitly publish runtime snapshots.
// Both requests and responses go through the authoritative exported Do schemas.
const api = String.raw`
import {Effect} from 'effect';
import {decode, RuntimeRequestError, doRunSchema, doSaveRequestSchema, doStartRequestSchema,
  doReadRequestSchema, doRetryRequestSchema, doCompleteRequestSchema, doDiscoverRequestSchema,
  doListReplySchema, doRunReplySchema, doDiscoverReplySchema,
  doChatCreateRequestSchema, doChatCreateReplySchema} from '@dovo/protocol';
const now='2026-10-17T10:00:00.000Z';
const uuid=()=>crypto.randomUUID();
const owner={id:'owner-profile',name:'Demo workstation',connection:{address:'http://workstation.demo:8080',token:'demo-paired-token',runtimeId:'owner-runtime'}};
const remote={id:'remote-profile',name:'Demo build computer',connection:{address:'http://build.demo:8080',token:'demo-remote-token',runtimeId:'build-runtime'}};
const catalog={runtimeId:'local',computers:[{id:'local',name:'Demo workstation',local:true},{id:'build-runtime',name:'Demo build computer',local:false}],projects:[{id:'studio',name:'Dovo Studio'}],agents:[{id:'sol',name:'Sol',provider:'codex'}]};
window.calls=[];window.failures={};window.lostReplies={};window.held=[];window.holdPath='';window.runs=[];window.navigations=[];window.chats=new Map();window.refreshes=[];
window.seed=()=>decode(doRunSchema,{id:uuid(),revision:uuid(),title:'Demo · Improve pairing recovery',goal:'Make reconnecting to a paired computer clear and reliable. Review the changes and verification before accepting.',maxConcurrency:2,status:'draft',items:[{id:'reconnect',title:'Explain pairing recovery',instructions:'Improve the reconnect screen and preserve HTTP LAN/VPN support. Keep pairing tokens required. Verify the offline and recovery states.',dependsOn:[],target:{runtimeId:'local',repositoryId:'studio',agentId:'sol',execution:'worktree'},state:{status:'pending',attempt:0,updatedAt:now}},{id:'verify',title:'Verify the recovery flow',instructions:'Inspect the implementation, exercise the recovery flow, and report evidence and remaining limits. Do not publish or merge.',dependsOn:['reconnect'],target:{runtimeId:'build-runtime',repositoryId:'studio',agentId:'sol',execution:'worktree'},state:{status:'pending',attempt:0,updatedAt:now}}],createdAt:now,updatedAt:now});
const summary=run=>({id:run.id,revision:run.revision,title:run.title,status:run.status,items:Object.fromEntries(['pending','dispatching','running','waiting','blocked','completed','failed','cancelling','cancelled'].map(status=>[status,run.items.filter(item=>item.state.status===status).length])),createdAt:run.createdAt,updatedAt:run.updatedAt});
window.publish=stage=>{
  const states={running:['running','pending'],waiting:['waiting','pending'],attention:['failed','pending'],blocked:['completed','blocked'],review:['completed','completed'],cancelling:['completed','cancelling'],cancelled:['completed','cancelled']}[stage];
  if(!states)throw new Error('Unknown fixture stage: '+stage);
  const run=structuredClone(window.runs[0]);run.status=stage==='waiting'?'running':stage==='blocked'?'attention':stage;
  run.items=run.items.map((item,index)=>{
    const status=states[index];
    return {...item,state:{status,attempt:status==='pending'?0:1,...(!['pending','blocked'].includes(status)?{taskId:index?'verify-thread':'reconnect-thread'}:{}),updatedAt:now,
      ...(status==='waiting'?{attention:'question'}:{}),
      ...(status==='failed'?{error:'Verification command failed; inspect the thread before retrying.'}:{}),
      ...(status==='blocked'?{blockedReason:'Do is disabled on Demo build computer. Enable it there before dispatch.'}:{}),
      ...(status==='cancelling'?{blockedReason:'Remote stop is not confirmed. The target computer is offline.'}:{}),
      ...(status==='completed'?{result:{source:'agent-message',summary:index?'Recovery checks passed in the demo scenario. Native device behavior has not been verified.':'Updated reconnect guidance and preserved paired HTTP access. Changes are ready for human inspection.',truncated:false,branch:index?'do/verify-recovery':'do/pairing-recovery'}}:{})}};
  });
  window.runs[0]=decode(doRunSchema,run);
};
const schemas={save:doSaveRequestSchema,start:doStartRequestSchema,read:doReadRequestSchema,cancel:doReadRequestSchema,retry:doRetryRequestSchema,complete:doCompleteRequestSchema,discover:doDiscoverRequestSchema};
const request=async(profile,path,input={},schema,method)=>{
  window.calls.push({profile:profile?.id,path,input:structuredClone(input),method});
  if(window.failures[path])throw new RuntimeRequestError({status:409,message:window.failures[path]});
  if(path==='/api/do/chat/create'){
    input=decode(doChatCreateRequestSchema,input);
    const key=JSON.stringify([profile.id,input.id]);
    const previous=window.chats.get(key);
    if(previous&&JSON.stringify(previous.input)!==JSON.stringify(input))throw new RuntimeRequestError({status:409,message:'Chat request changed. Use a new request ID.'});
    const chat=previous??{input,reply:decode(doChatCreateReplySchema,{taskId:'coordinator-'+input.id})};
    window.chats.set(key,chat);
    if(window.holdPath===path)await new Promise(resolve=>window.held.push(resolve));
    if(window.lostReplies[path])throw new RuntimeRequestError({status:503,message:window.lostReplies[path]});
    return schema?decode(schema,structuredClone(chat.reply)):structuredClone(chat.reply);
  }
  const operation=path.split('/').at(-1);
  if(operation!=='list'&&!schemas[operation])throw new Error('Unexpected Do fixture endpoint: '+path);
  if(schemas[operation])input=decode(schemas[operation],input);
  let reply;
  if(operation==='list')reply=decode(doListReplySchema,{runs:window.runs.map(summary)});
  else if(operation==='discover')reply=decode(doDiscoverReplySchema,{...catalog,runtimeId:input.runtimeId??'local',...(input.runtimeId&&input.runtimeId!=='local'?{computers:undefined}: {})});
  else {
    let run=window.runs.find(run=>run.id===input.id);
    if(operation==='save'){
      if(run&&(run.status!=='draft'||input.expectedRevision!==run.revision))throw new RuntimeRequestError({status:409,message:'Plan changed on the owner computer. Reload before saving.'});
      run=decode(doRunSchema,{...input,revision:uuid(),status:'draft',maxConcurrency:input.maxConcurrency??2,items:input.items.map(item=>({...item,state:{status:'pending',attempt:0,updatedAt:now}})),createdAt:run?.createdAt??now,updatedAt:now});
      window.runs=[run,...window.runs.filter(previous=>previous.id!==run.id)];
    }else if(!run)throw new RuntimeRequestError({status:404,message:'Unknown run'});
    else if(operation==='start'){
      if(input.expectedRevision!==run.revision)throw new RuntimeRequestError({status:409,message:'The saved plan changed. Reload before starting.'});
      window.publish('running');run=window.runs[0];
    }else if(operation==='retry'){
      const ids=input.itemIds??run.items.filter(item=>['failed','blocked','cancelled'].includes(item.state.status)).map(item=>item.id);
      run={...run,status:'running',items:run.items.map(item=>ids.includes(item.id)?{...item,state:{status:'running',attempt:item.state.attempt+(item.state.status==='blocked'?0:1),taskId:item.state.taskId,updatedAt:now}}:item)};
    }else if(operation==='cancel'){window.publish('cancelling');run=window.runs[0]}
    else if(operation==='complete'){
      if(run.status!=='review')throw new RuntimeRequestError({status:409,message:'Run is not ready for review'});
      run={...run,status:'completed',review:{decision:input.decision,note:input.note,reviewedAt:now}};
    }
    run=decode(doRunSchema,run);window.runs=window.runs.map(previous=>previous.id===run.id?run:previous);
    reply=decode(doRunReplySchema,{run});
  }
  if(window.holdPath===path)await new Promise(resolve=>window.held.push(resolve));
  return schema?decode(schema,structuredClone(reply)):structuredClone(reply);
};
window.store={connected:true,snapshot:{runtimeId:'owner-runtime',doEnabled:false,workspace:{repositories:catalog.projects,agents:catalog.agents,tasks:[]}},runtimeRegistry:{activeId:owner.id,profiles:[owner,remote]},readRuntime:request,refreshRuntime:async profile=>{window.refreshes.push(profile.id)},switchRuntime:async id=>{window.switched=id}};
window.store.runtimes=[{profile:owner,connected:true,snapshot:window.store.snapshot},{profile:remote,connected:true,snapshot:{runtimeId:'build-runtime',doEnabled:true}}];
window.host={navigate:route=>{window.navigations.push(route);window.onNavigate?.(route)},taskNavigationGuard:()=>{const scope=JSON.stringify(window.store.runtimeRegistry);return()=>scope===JSON.stringify(window.store.runtimeRegistry)}};
window.runtime={...window.store,profile:owner,entries:window.store.runtimes,profiles:[owner,remote],readEffect:(path,input,schema)=>Effect.tryPromise({try:()=>request(owner,path,input,schema),catch:error=>error}),callEffect:(path,input,schema)=>Effect.tryPromise({try:()=>request(owner,path,input,schema),catch:error=>error}),refresh:async()=>{},select:async id=>{window.switched=id}};
window.runtime.read=(path,input,schema)=>request(owner,path,input,schema);
window.runtime.call=window.runtime.read;
`

const options = (contents) => ({
  stdin: { contents, resolveDir: root, loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: `${root}/packages/studio-ui/node_modules/react`,
    'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
    '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    '@dovo/client-runtime': `${root}/packages/client-runtime/src/index.ts`,
  },
  nodePaths: [`${root}/node_modules`, `${root}/packages/studio-ui/node_modules`],
})
const desktopBundle = await bundleBrowser(
  options(`${api}
import {createRoot} from 'react-dom/client';import {useState} from 'react';import DoView from '${desktop}/do-view';
import {studioThemes} from '${root}/packages/studio-core/src/themes';import {systemAppFont} from '${root}/packages/studio-core/src/fonts';
window.design={font:systemAppFont,background:studioThemes.dovo.dark.background,foreground:studioThemes.dovo.dark.foreground};
function App(){const[version,render]=useState(0);const[route,navigate]=useState({viewId:'do'});window.onNavigate=route=>{if(route.viewId==='do')navigate(route)};window.render=()=>render(value=>value+1);return <DoView key={version} {...route}/>};
createRoot(document.getElementById('app')).render(<App/>);`),
  [
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>window.store;export const useStudioHost=()=>window.host;export const useAppPreferences=()=>({markdownComposerPreview:false});export const useResolvedTheme=()=>'dark';export {studioSyntaxTheme} from '${root}/packages/studio-core/src/themes';`,
    },
    {
      path: '@dovo/studio-ui',
      importer: desktop,
      contents: `export {Button} from '${ui}/components/ui/button';export {Input} from '${ui}/components/ui/input';export {PageHeader} from '${ui}/page-header';export {EmptyState} from '${ui}/components/empty-state';export {cn} from '${ui}/lib/utils';export {ComposerSurface,ComposerTextarea,ComposerSubmit} from '${ui}/composer-surface';`,
    },
    {
      path: '@dovo/studio-core/state',
      importer: ui,
      contents: `export {useState as useApplicationState} from 'react';`,
    },
  ],
)

// Browser adapters for native host primitives only. Do, its editor, settings styling,
// fields, actions, Effect state and request lifetime handling are the production components.
const native = String.raw`
const flat=value=>Object.assign({},...(Array.isArray(value)?value.flat(Infinity).filter(Boolean):[value]));
const css=value=>{const s={...flat(value)};for(const [key,edges] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom'],marginHorizontal:['marginLeft','marginRight'],marginVertical:['marginTop','marginBottom']})){if(s[key]!==undefined){for(const edge of edges)s[edge]=s[key];delete s[key]}}if(typeof s.lineHeight==='number')s.lineHeight+='px';if(Object.keys(s).some(key=>/^border.*Width$/.test(key)))s.borderStyle='solid';delete s.textAlignVertical;return s};
export const StyleSheet={create:s=>s,flatten:flat,hairlineWidth:1};
export const Platform={OS:'ios',Version:26,select:options=>options.ios??options.default};
export const useWindowDimensions=()=>({width:innerWidth,height:innerHeight,fontScale:1,scale:1});
export const View=({children,style,accessibilityLabel,testID})=><div aria-label={accessibilityLabel} data-testid={testID} style={{display:'flex',flexDirection:'column',minWidth:0,flexShrink:0,boxSizing:'border-box',...css(style)}}>{children}</div>;
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':accessibilityRole} aria-level={accessibilityRole==='header'?2:undefined} style={{display:'block',whiteSpace:'pre-wrap',overflowWrap:'anywhere',...css(style)}}>{children}</span>;
export const TextInput=({style,accessibilityLabel,onChangeText,multiline,editable=true,value,placeholder,maxLength,ref})=>{const props={ref,'aria-label':accessibilityLabel,disabled:!editable,value,placeholder,maxLength,onChange:event=>onChangeText(event.target.value),style:{boxSizing:'border-box',fontFamily:'inherit',maxWidth:'100%',background:'transparent',border:0,outline:'none',resize:'none',...css(style)}};return multiline?<textarea {...props}/>:<input {...props}/>};
export const Pressable=({children,style,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState,testID})=><button type="button" aria-label={accessibilityLabel} role={accessibilityRole==='switch'?'switch':undefined} aria-checked={accessibilityRole==='switch'?accessibilityState?.checked:undefined} data-testid={testID} disabled={disabled} onClick={onPress} style={{display:'flex',flexDirection:'column',border:0,background:'transparent',font:'inherit',textAlign:'left',boxSizing:'border-box',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const ScrollView=({children,style,contentContainerStyle,horizontal})=><div data-native-scroll style={{overflow:'auto',minHeight:0,...css(style)}}><div style={{display:'flex',flexDirection:horizontal?'row':'column',...css(contentContainerStyle)}}>{children}</div></div>;
export const Switch=({value,onValueChange,disabled,accessibilityLabel})=><input aria-label={accessibilityLabel} type="checkbox" role="switch" checked={value} disabled={disabled} onChange={event=>onValueChange(event.target.checked)}/>;
export const ActivityIndicator=({accessibilityLabel})=><span role="status" aria-label={accessibilityLabel}/>;
export const Keyboard={dismiss:()=>{window.keyboardDismissed=true}};
`
const mobileOptions = options(`${api}
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {useState} from 'react';import DoScreen from '${mobile}/screens/do';import DoPlansScreen from '${mobile}/screens/do-plans';
window.runtime.overviews=window.store.runtimes;window.runtime.overviews.forEach(entry=>entry.snapshot.doEnabled=false);
window.focused=true;
function App(){const[version,render]=useState(0);const[,update]=useState(0);const[route,navigate]=useState({});window.onNavigate=route=>{if(route.pathname==='/settings/do-plans')navigate(route)};window.render=()=>render(value=>value+1);window.update=()=>flushSync(()=>update(value=>value+1));return route.pathname==='/settings/do-plans'?<DoPlansScreen key={version} {...route.params}/>:<DoScreen key={version}/>};createRoot(document.getElementById('app')).render(<App/>);`)
mobileOptions.alias['@dovo/studio-core/themes'] = `${root}/packages/studio-core/src/themes.ts`
mobileOptions.alias['@dovo/studio-core/code-themes'] =
  `${root}/packages/studio-core/src/code-themes.ts`
const mobileBundle = await bundleBrowser(mobileOptions, [
  { path: 'react-native', importer: mobile, contents: native },
  {
    path: 'expo-router',
    importer: mobile,
    contents: `export const router={push:route=>{window.navigations.push(route);window.onNavigate?.(route)}};`,
  },
  {
    path: 'expo-crypto',
    importer: `${mobile}/do`,
    contents: `export const randomUUID=()=>crypto.randomUUID();`,
  },
  {
    path: '../runtime/connection/provider',
    importer: mobile,
    contents: `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=>children;`,
  },
  {
    path: '../shell/navigation',
    importer: `${mobile}/screens`,
    contents: `export const useNavigation=()=>({focused:window.focused});`,
  },
  {
    path: '../ui/layout/screen-header',
    importer: `${mobile}/screens`,
    contents: `export const ScreenHeader=({title,buttons=[]})=><header style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px',fontSize:22,fontWeight:700}}><span>{title}</span>{buttons.map(button=><button key={button.label} aria-label={button.label} onClick={button.onPress} style={{fontSize:13}}>{button.label}</button>)}</header>;`,
  },
  {
    path: '../../runtime/preferences/app-preferences',
    importer: `${mobile}/ui/content`,
    contents: `export const useCarMode=()=>false;export const carZoom=1;`,
  },
  {
    path: '../ui/controls/icon',
    importer: `${mobile}/screens`,
    contents: `export const Icon=()=>null;`,
  },
  { path: './icon', importer: `${mobile}/ui/controls`, contents: `export const Icon=()=>null;` },
  {
    path: './icon-button',
    importer: `${mobile}/ui/controls`,
    contents: `export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress}>{label}</button>;`,
  },
  {
    path: '../ui/controls/icon-button',
    importer: `${mobile}/do`,
    contents: `export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress}>{label}</button>;`,
  },
  {
    path: '../ui/layout/sheet',
    importer: mobile,
    contents: `import {createPortal} from 'react-dom';export const useInsideSheet=()=>true;export const Sheet=({title,children,onClose})=>createPortal(<section role="dialog" aria-label={title} style={{position:'fixed',top:34,left:0,right:0,bottom:0,background:'#000',display:'flex',flexDirection:'column'}}><header style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:16,fontWeight:600,fontSize:19}}>{title}<button aria-label="Close sheet" onClick={onClose}>Close</button></header>{children}</section>,document.body);`,
  },
  {
    path: '../ui/controls/choice',
    importer: mobile,
    contents: `export const Choice=({label,value,onChange,items,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)} style={{width:'100%',minHeight:44,color:'#ccc',background:'transparent',border:0,font:'inherit'}}><option value="" disabled>{label}</option>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
  },
])

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

const browser = await chromium.launch()
const errors = []
await mkdir(screenshots, { recursive: true })
async function mount(bundle, width, height, label, styles = '') {
  const page = await browser.newPage({ viewport: { width, height } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('Do component error:', error.message)
  })
  page.on('dialog', (dialog) => dialog.accept())
  await page.route('http://localhost:4319/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<body class="studio dark"><div id="demo-label">DEMO · ${label} · simulated runtime data</div><div id="app"></div></body>`,
    }),
  )
  await page.goto('http://localhost:4319/')
  assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8')
  assert.equal(
    await page.locator('#demo-label').textContent(),
    `DEMO · ${label} · simulated runtime data`,
    'Demo labels preserve UTF-8 punctuation',
  )
  await page.addStyleTag({
    content:
      styles +
      `\nbody{margin:0;background:var(--background,#101114);color:var(--foreground,#eee);font-family:var(--app-font-family,system-ui)}#demo-label{height:34px;box-sizing:border-box;padding:5px 16px;font:11px/12px system-ui;color:#aeb7c3;border-bottom:1px solid #333}#app{height:calc(100vh - 34px);min-width:0}`,
  })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  return page
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${screenshots}/${name}.png` })
}
async function openSaved(page) {
  await page.getByRole('navigation', { name: 'Saved Do plans' }).getByRole('button').first().click()
}
async function publishDesktop(page, stage) {
  await page.evaluate((stage) => window.publish(stage), stage)
  await openSaved(page)
}

try {
  const page = await mount(desktopBundle, 1440, 1000, 'Desktop Do UI', css)
  assert.equal(
    await page.evaluate(() => {
      const expected = document.createElement('span')
      expected.style.fontFamily = window.design.font
      expected.style.backgroundColor = window.design.background
      expected.style.color = window.design.foreground
      document.body.append(expected)
      const actual = getComputedStyle(document.body),
        design = getComputedStyle(expected)
      const matches =
        actual.fontFamily === design.fontFamily &&
        actual.backgroundColor === design.backgroundColor &&
        actual.color === design.color
      expected.remove()
      return matches
    }),
    true,
    'Desktop screenshots use the product default Dovo theme and application font stack',
  )
  await page.getByText('Do is turned off', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.calls), [])
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.navigations), [{ viewId: 'running-tasks' }])
  await page.evaluate(() => {
    window.store.snapshot.doEnabled = true
    window.failures['/api/do/discover'] = 'Could not load planning agents.'
    window.render()
  })
  await page.getByRole('alert').filter({ hasText: 'Could not load planning agents' }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => delete window.failures['/api/do/discover'])
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await page.getByRole('combobox', { name: /^Project context/ }).selectOption('studio')
  await page.getByRole('combobox', { name: /^Agent/ }).selectOption('sol')
  const goal =
    'Make reconnecting to a paired computer clear and reliable. Ask about scope, then propose a plan. Do not commit, push or publish.'
  await page.getByLabel('Message Do', { exact: true }).fill('   ')
  assert.equal(
    await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(),
    true,
  )
  await page.getByLabel('Message Do', { exact: true }).fill(goal)
  await shot(page, 'desktop-chat-start')
  await page.evaluate(
    () =>
      (window.lostReplies['/api/do/chat/create'] = 'The chat reply was lost. Try sending again.'),
  )
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'The chat reply was lost' }).waitFor()
  assert.equal(await page.getByLabel('Message Do', { exact: true }).inputValue(), goal)
  assert.equal(await page.evaluate(() => window.chats.size), 1)
  await page.evaluate(() => {
    delete window.lostReplies['/api/do/chat/create']
    window.holdPath = '/api/do/chat/create'
  })
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.waitForFunction(() => window.held.length === 1)
  // A second submit while the request is pending must not deliver another create.
  await page
    .getByRole('form', { name: 'Start a Do conversation' })
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/do/chat/create').length,
    ),
    2,
  )
  await page.evaluate(() => {
    window.holdPath = ''
    window.held.splice(0).forEach((resolve) => resolve())
  })
  await page.waitForFunction(() => window.navigations.at(-1)?.viewId === 'tasks')
  const create = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/do/chat/create'),
  )
  assert.deepEqual(create[1].input, create[0].input, 'Retry reuses the exact request ID and goal')
  assert.equal(create[1].method, 'POST')
  assert.equal(create[1].profile, 'owner-profile')
  assert.deepEqual(
    { ...create[1].input, id: undefined },
    { id: undefined, text: goal, repositoryId: 'studio', agentId: 'sol' },
  )
  assert.equal(await page.evaluate(() => window.chats.size), 1)
  assert.deepEqual(await page.evaluate(() => window.refreshes), ['owner-profile'])
  assert.deepEqual(await page.evaluate(() => window.navigations.at(-1)), {
    viewId: 'tasks',
    entityId: `coordinator-${create[1].input.id}`,
  })
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => ['/api/do/save', '/api/do/start'].includes(call.path)),
    ),
    false,
  )
  // A create reply from an old owner must not open a thread on the newly selected computer.
  const navigationCount = await page.evaluate(() => window.navigations.length)
  await page
    .getByLabel('Message Do', { exact: true })
    .fill('A different goal for the original computer.')
  await page.evaluate(() => (window.holdPath = '/api/do/chat/create'))
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.waitForFunction(() => window.held.length === 1)
  await page.evaluate(() => {
    window.store.runtimeRegistry = { ...window.store.runtimeRegistry, activeId: 'remote-profile' }
    window.render()
  })
  await page.getByLabel('Message Do', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.holdPath = ''
    window.held.splice(0).forEach((resolve) => resolve())
  })
  await page.waitForFunction(
    () =>
      window.calls.filter((call) => call.path === '/api/do/discover').at(-1)?.profile ===
      'remote-profile',
  )
  assert.equal(await page.evaluate(() => window.navigations.length), navigationCount)
  assert.deepEqual(await page.evaluate(() => window.refreshes), ['owner-profile'])
  await page.evaluate(() => {
    window.store.runtimeRegistry = { ...window.store.runtimeRegistry, activeId: 'owner-profile' }
    window.render()
  })
  await page.getByRole('button', { name: 'Review plans', exact: true }).click()
  await page.getByRole('button', { name: 'New plan', exact: true }).waitFor()
  await page.evaluate(
    () => (window.failures['/api/do/list'] = 'Could not load plans from the owner computer.'),
  )
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Could not load plans' }).waitFor()
  await page.evaluate(() => delete window.failures['/api/do/list'])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('button', { name: 'New plan', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Save plan', exact: true }).isDisabled(),
    true,
  )
  await page.getByLabel('Plan title', { exact: true }).fill('Demo · Improve pairing recovery')
  await page
    .getByRole('textbox', { name: /^Goal/ })
    .fill(
      'Make reconnecting to a paired computer clear and reliable. Review changes before accepting.',
    )
  const item = page
    .locator('fieldset')
    .filter({ has: page.locator('legend').getByText('item-1', { exact: true }) })
    .last()
  await item.getByLabel('Title', { exact: true }).fill('Explain pairing recovery')
  await item
    .getByLabel('Instructions', { exact: true })
    .fill(
      'Improve reconnect guidance. Preserve HTTP LAN/VPN access and required pairing tokens. Verify the recovery flow.',
    )
  await item.getByRole('combobox', { name: /^Project/ }).selectOption('studio')
  await item.getByRole('combobox', { name: /^Agent/ }).selectOption('sol')
  await page.getByRole('button', { name: 'Save plan', exact: true }).click()
  await page.getByRole('button', { name: 'Start plan', exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.path === '/api/do/start').length),
    0,
  )
  assert.equal(await page.evaluate(() => window.runs[0].status), 'draft')
  // Unsaved edits cannot start a different revision.
  await page.getByRole('textbox', { name: /^Goal/ }).fill('Updated goal requiring another save.')
  assert.equal(
    await page.getByRole('button', { name: 'Start plan', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(
    () =>
      (window.failures['/api/do/save'] =
        'Plan changed on the owner computer. Reload before saving.'),
  )
  await page.getByRole('button', { name: 'Save plan', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Plan changed on the owner computer' }).waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: /^Goal/ }).inputValue(),
    'Updated goal requiring another save.',
  )
  await page.evaluate(() => {
    delete window.failures['/api/do/save']
    window.runs = [window.seed()]
  })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await openSaved(page)
  for (const instructions of await page.locator('article summary').all()) await instructions.click()
  await shot(page, 'desktop-proposal-review')
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
  const second = page
    .locator('fieldset')
    .filter({ has: page.locator('legend').getByText('verify', { exact: true }) })
    .last()
  assert.equal(
    await second
      .getByRole('checkbox', { name: 'Explain pairing recovery', exact: true })
      .isChecked(),
    true,
  )
  const cyclicDependency = page
    .locator('fieldset')
    .filter({ has: page.locator('legend').getByText('reconnect', { exact: true }) })
    .last()
    .getByRole('checkbox', { name: 'Verify the recovery flow', exact: true })
  await cyclicDependency.check()
  await page.getByText('Dependencies cannot form a cycle', { exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Save plan', exact: true }).isDisabled(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Start plan', exact: true }).isDisabled(),
    true,
  )
  await cyclicDependency.uncheck()
  // A failed start keeps the saved draft intact and retryable by a human.
  await page.evaluate(() => (window.failures['/api/do/start'] = 'Owner computer is unavailable.'))
  await page.getByRole('button', { name: 'Start plan', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Owner computer is unavailable.' }).waitFor()
  await page.evaluate(() => delete window.failures['/api/do/start'])
  await page.getByRole('button', { name: 'Start plan', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel run', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.runs[0].items[1].state.status), 'pending')
  await shot(page, 'desktop-running')
  // Let the real poller observe the next runtime snapshot without a manual read.
  await page.evaluate(() => window.publish('waiting'))
  await page
    .getByText('Needs human question. Open the thread to respond.', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Open thread', exact: true }).first().click()
  assert.deepEqual(await page.evaluate(() => window.navigations.at(-1)), {
    viewId: 'tasks',
    entityId: 'reconnect-thread',
  })
  await publishDesktop(page, 'attention')
  await page.getByRole('button', { name: 'Retry item', exact: true }).first().click()
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/do/retry').at(-1).input.itemIds,
    ),
    ['reconnect'],
  )
  assert.equal(await page.evaluate(() => window.runs[0].items[0].state.taskId), 'reconnect-thread')
  assert.equal(await page.evaluate(() => window.runs[0].items[0].state.attempt), 2)
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click()
  await page.getByRole('button', { name: 'Retry cancellation', exact: true }).waitFor()
  await page.getByRole('alert').filter({ hasText: 'Remote stop is not confirmed' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Retry item', exact: true }).count(), 0)
  await publishDesktop(page, 'cancelled')
  await page.getByRole('button', { name: 'Retry unfinished items', exact: true }).click()
  assert.equal(await page.evaluate(() => window.runs[0].items[0].state.status), 'completed')
  await publishDesktop(page, 'blocked')
  await page
    .getByRole('alert')
    .filter({ hasText: 'Do is disabled on Demo build computer' })
    .waitFor()
  await page.getByRole('button', { name: 'Retry item', exact: true }).click()
  assert.equal(await page.evaluate(() => window.runs[0].items[1].state.attempt), 1)
  assert.equal(await page.evaluate(() => window.runs[0].items[0].state.status), 'completed')
  await publishDesktop(page, 'review')
  await page
    .getByLabel('Review note (optional)', { exact: true })
    .fill(
      'Demo review: inspected both threads and their changes. No merge or publication requested.',
    )
  await page.getByRole('button', { name: 'Accept results', exact: true }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Open thread', exact: true }).last().click()
  assert.equal(
    await page.evaluate(() => window.switched),
    'remote-profile',
    'Remote thread navigation resolves the authoritative runtime ID to the saved profile ID',
  )
  assert.deepEqual(await page.evaluate(() => window.navigations.at(-1)), {
    viewId: 'tasks',
    entityId: 'verify-thread',
  })
  await page.getByRole('button', { name: 'Accept results', exact: true }).click()
  await page.getByText('Human review: accepted', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.runs[0].review.note),
    'Demo review: inspected both threads and their changes. No merge or publication requested.',
  )
  const navigations = await page.evaluate(() => window.navigations.length)
  await page.evaluate(
    () =>
      (window.store.runtimes = window.store.runtimes.filter(
        (entry) => entry.profile.id !== 'remote-profile',
      )),
  )
  await openSaved(page)
  await page.getByRole('button', { name: 'Open thread', exact: true }).last().click()
  await page.getByRole('alert').filter({ hasText: 'not paired in this Studio' }).waitFor()
  assert.equal(await page.evaluate(() => window.navigations.length), navigations)
  // An old owner response must not populate a newly selected runtime.
  await page.evaluate(() => {
    window.holdPath = '/api/do/read'
    window.render()
  })
  await openSaved(page)
  await page.waitForFunction(() => window.held.length > 0)
  await page.evaluate(() => {
    window.store.runtimeRegistry = { ...window.store.runtimeRegistry, activeId: 'remote-profile' }
    window.render()
    window.holdPath = ''
    window.held.splice(0).forEach((resolve) => resolve())
  })
  await page.getByRole('navigation', { name: 'Saved Do plans' }).waitFor()
  assert.equal(await page.getByText('Human review: accepted', { exact: true }).count(), 0)
  await page.close()
  console.log(
    'Desktop Do: chat discovery/error/retry, request identity after a lost reply, duplicate-submit guard, normal task navigation and stale owner guards; secondary editor, human start, revisions, dependencies, waiting, retry, cancellation and final review passed.',
  )
  const phone = await mount(
    mobileBundle,
    390,
    844,
    'Mobile components in browser',
    `*{box-sizing:border-box}button,input,textarea,select{font:inherit}button{color:inherit;border:1px solid #38383a;background:#252529;border-radius:12px;padding:10px}button:disabled{opacity:.4}textarea{resize:vertical}#app>div{height:100%}`,
  )
  await phone.getByText('Enable Do on a computer to get started.', { exact: true }).waitFor()
  assert.deepEqual(await phone.evaluate(() => window.calls), [])
  await phone.getByRole('button', { name: 'Open computer preferences', exact: true }).click()
  assert.equal(await phone.evaluate(() => window.navigations.at(-1)), '/settings/devices')
  await phone.evaluate(() => {
    window.runtime.snapshot.doEnabled = true
    window.render()
  })
  await phone.getByLabel('Do message', { exact: true }).fill('   ')
  assert.equal(await phone.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true)
  await phone.getByRole('button', { name: 'Chat options', exact: true }).click()
  const chatOptions = phone.getByRole('dialog', { name: 'Chat options', exact: true })
  await chatOptions.getByLabel('Project (optional)', { exact: true }).selectOption('studio')
  await chatOptions.getByLabel('Agent (optional)', { exact: true }).selectOption('sol')
  await phone.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await phone.getByLabel('Do message', { exact: true }).fill(goal)
  await shot(phone, 'mobile-chat-start-browser')
  await phone.evaluate(
    () =>
      (window.lostReplies['/api/do/chat/create'] = 'The chat reply was lost. Try sending again.'),
  )
  await phone.getByRole('button', { name: 'Send', exact: true }).click()
  await phone.getByRole('alert').filter({ hasText: 'The chat reply was lost' }).waitFor()
  assert.equal(await phone.getByLabel('Do message', { exact: true }).inputValue(), goal)
  assert.equal(await phone.evaluate(() => window.chats.size), 1)
  await phone.evaluate(() => {
    delete window.lostReplies['/api/do/chat/create']
    window.holdPath = '/api/do/chat/create'
  })
  await phone.getByRole('button', { name: 'Send', exact: true }).click()
  await phone.waitForFunction(() => window.held.length === 1)
  assert.equal(await phone.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true)
  await phone.evaluate(() => {
    window.holdPath = ''
    window.held.splice(0).forEach((resolve) => resolve())
  })
  await phone.waitForFunction(() => window.navigations.at(-1)?.params?.taskId)
  const mobileCreate = await phone.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/do/chat/create'),
  )
  assert.equal(mobileCreate.length, 2)
  assert.deepEqual(mobileCreate[1].input, mobileCreate[0].input)
  assert.deepEqual(
    { ...mobileCreate[1].input, id: undefined },
    { id: undefined, text: goal, repositoryId: 'studio', agentId: 'sol' },
  )
  assert.deepEqual(await phone.evaluate(() => window.navigations.at(-1).params), {
    runtimeId: 'owner-profile',
    taskId: `coordinator-${mobileCreate[1].input.id}`,
  })
  assert.equal(await phone.evaluate(() => window.chats.size), 1)
  assert.equal(
    await phone.evaluate(() =>
      window.calls.some((call) => ['/api/do/save', '/api/do/start'].includes(call.path)),
    ),
    false,
  )
  // Losing focus while a create is pending cannot navigate away from the user's new screen.
  const mobileNavigationCount = await phone.evaluate(() => window.navigations.length)
  await phone
    .getByLabel('Do message', { exact: true })
    .fill('Another goal that stays on its original computer.')
  await phone.evaluate(() => (window.holdPath = '/api/do/chat/create'))
  await phone.getByRole('button', { name: 'Send', exact: true }).click()
  await phone.waitForFunction(() => window.held.length === 1)
  await phone.evaluate(() => {
    window.focused = false
    window.update()
  })
  await phone.getByRole('button', { name: 'Review plans', exact: true }).waitFor()
  await phone.evaluate(() => {
    window.holdPath = ''
    window.held.splice(0).forEach((resolve) => resolve())
  })
  await phone.getByRole('status', { name: 'Sending goal' }).waitFor({ state: 'hidden' })
  assert.equal(await phone.evaluate(() => window.navigations.length), mobileNavigationCount)
  await phone.evaluate(() => {
    window.focused = true
    window.runtime.connected = false
    window.update()
  })
  await phone.getByRole('alert').filter({ hasText: 'This computer is offline' }).waitFor()
  assert.equal(await phone.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true)
  assert.equal(
    await phone.getByLabel('Do message', { exact: true }).inputValue(),
    'Another goal that stays on its original computer.',
  )
  await phone.evaluate(() => {
    window.runtime.connected = true
    window.update()
  })
  await phone.getByRole('button', { name: 'Review plans', exact: true }).click()
  await phone.evaluate(
    () =>
      (window.failures['/api/do/discover'] = 'Demo target discovery is temporarily unavailable.'),
  )
  await phone.getByRole('button', { name: 'New plan', exact: true }).click()
  const editor = phone.getByRole('dialog', { name: 'New Do plan', exact: true })
  await editor.getByRole('alert').filter({ hasText: 'Demo target discovery' }).waitFor()
  await phone.evaluate(() => delete window.failures['/api/do/discover'])
  await editor.getByRole('button', { name: 'Retry computer discovery', exact: true }).click()
  await editor
    .getByRole('alert')
    .filter({ hasText: 'Demo target discovery' })
    .waitFor({ state: 'hidden' })
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click()
  await editor.getByRole('alert').filter({ hasText: 'Add a plan name' }).waitFor()
  assert.equal(
    await phone.evaluate(() => window.calls.some((call) => call.path === '/api/do/save')),
    false,
  )
  await editor.getByLabel('Plan name', { exact: true }).fill('Demo · Improve pairing recovery')
  await editor
    .getByLabel('Goal', { exact: true })
    .fill('Make reconnecting clear and reliable. Review all changes before accepting.')
  await editor.getByRole('button', { name: 'Add work item', exact: true }).click()
  await editor.getByLabel('Work item name', { exact: true }).fill('Explain pairing recovery')
  await editor
    .getByLabel('Instructions', { exact: true })
    .fill(
      'Improve reconnect guidance. Preserve HTTP LAN/VPN access and pairing tokens. Verify the flow.',
    )
  await editor.getByLabel('Project', { exact: true }).selectOption('studio')
  await editor.getByLabel('Agent', { exact: true }).selectOption('sol')
  await editor.getByRole('button', { name: 'Save plan', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await phone.getByText('Saved draft', { exact: true }).waitFor()
  assert.equal(await phone.evaluate(() => window.runs[0].status), 'draft')
  assert.equal(
    await phone.evaluate(() => window.calls.some((call) => call.path === '/api/do/start')),
    false,
  )
  await phone.getByRole('button', { name: 'Start plan', exact: true }).click()
  await phone.getByRole('dialog', { name: 'Start this saved plan?', exact: true }).waitFor()
  await phone.evaluate(
    () =>
      (window.failures['/api/do/start'] =
        'Plan changed on the owner computer. Reload before starting.'),
  )
  await phone.getByRole('button', { name: 'Start saved plan', exact: true }).click()
  await phone
    .getByRole('dialog')
    .getByRole('alert')
    .filter({ hasText: 'Plan changed on the owner computer' })
    .waitFor()
  await phone.getByRole('button', { name: 'Close sheet', exact: true }).click()
  await phone.evaluate(() => {
    delete window.failures['/api/do/start']
    const run = window.seed()
    run.items[0].target.linkedCheckouts = [
      {
        id: 'reference',
        repositoryId: 'recovery-reference',
        access: 'read-only',
        execution: 'worktree',
        existingWorktreePath: '/demo/worktrees/recovery-reference',
        baseBranch: 'main',
        branch: 'demo/recovery-reference',
      },
    ]
    window.runs = [run]
    window.render()
  })
  await phone.getByRole('button', { name: 'Refresh plans', exact: true }).click()
  await phone
    .getByLabel('Saved plan', { exact: true })
    .selectOption(await phone.evaluate(() => window.runs[0].id))
  await phone.getByText('Saved draft', { exact: true }).waitFor()
  const linkedCheckout = phone.getByText(
    'recovery-reference · Read only · Worktree · /demo/worktrees/recovery-reference · Base: main · Branch: demo/recovery-reference',
    { exact: true },
  )
  await linkedCheckout.scrollIntoViewIfNeeded()
  assert.equal(
    await linkedCheckout.isVisible(),
    true,
    'Review shows the linked checkout access, execution, path, base and branch before human approval',
  )
  await shot(phone, 'mobile-proposal-review-browser')
  await phone.getByRole('button', { name: 'Start plan', exact: true }).click()
  await phone.getByRole('button', { name: 'Start saved plan', exact: true }).click()
  await phone.getByText('Running', { exact: true }).waitFor()
  await phone.getByText('Running', { exact: true }).scrollIntoViewIfNeeded()
  await shot(phone, 'mobile-running-browser')
  async function publishMobile(stage) {
    await phone.evaluate((stage) => window.publish(stage), stage)
    await phone.getByRole('button', { name: 'Refresh plans', exact: true }).click()
  }
  await phone.evaluate(() => window.publish('waiting'))
  await phone
    .getByText('The agent has a question for you. Open the thread to respond.', { exact: true })
    .waitFor()
  await phone.getByRole('button', { name: 'Respond in thread', exact: true }).click()
  assert.deepEqual(await phone.evaluate(() => window.navigations.at(-1).params), {
    runtimeId: 'owner-profile',
    taskId: 'reconnect-thread',
  })
  await publishMobile('attention')
  await phone.getByRole('button', { name: 'Retry Explain pairing recovery', exact: true }).click()
  await phone.waitForFunction(() => window.runs[0].items[0].state.attempt === 2)
  await phone.getByRole('button', { name: 'Cancel run', exact: true }).click()
  await phone.getByRole('button', { name: 'Stop run', exact: true }).click()
  await phone.getByText('Stopping work', { exact: true }).waitFor()
  await phone.getByRole('alert').filter({ hasText: 'Remote stop is not confirmed' }).waitFor()
  assert.equal(
    await phone.getByRole('button', { name: 'Retry unfinished work', exact: true }).count(),
    0,
  )
  await publishMobile('cancelled')
  await phone.getByRole('button', { name: 'Retry unfinished work', exact: true }).click()
  await phone.waitForFunction(() => window.runs[0].status === 'running')
  assert.equal(await phone.evaluate(() => window.runs[0].items[0].state.status), 'completed')
  await publishMobile('review')
  await phone.getByRole('button', { name: 'Open work thread', exact: true }).last().click()
  assert.deepEqual(await phone.evaluate(() => window.navigations.at(-1).params), {
    runtimeId: 'remote-profile',
    taskId: 'verify-thread',
  })
  await phone.getByRole('button', { name: 'Review results', exact: true }).click()
  const review = phone.getByRole('dialog', { name: 'Final review', exact: true })
  await review.getByLabel('Decision', { exact: true }).selectOption('rejected')
  await review
    .getByLabel('Review note (optional)', { exact: true })
    .fill(
      'Demo review: native device behavior still needs verification. Keep the changes for inspection.',
    )
  await review.getByRole('button', { name: 'Record final review', exact: true }).click()
  await phone.getByText('Your review: Rejected', { exact: true }).waitFor()
  assert.equal(await phone.evaluate(() => window.runs[0].review.decision), 'rejected')
  await phone.evaluate(() => {
    window.runtime.connected = false
    window.render()
  })
  await phone.getByRole('alert').filter({ hasText: 'This computer is offline' }).waitFor()
  assert.equal(
    await phone.getByRole('button', { name: 'New plan', exact: true }).isDisabled(),
    true,
  )
  await phone.close()
  console.log(
    'Mobile Do components in Chromium: opt-in, chat options/send/error, retry identity after a lost reply, normal task navigation, focus/offline guards; secondary editor, human start/conflict, monitoring, waiting, retry, cancellation and final review passed. Native device behavior was not verified.',
  )
  console.log(
    'Screenshots: docs/screenshots/do/{desktop-chat-start,desktop-proposal-review,desktop-running,mobile-chat-start-browser,mobile-proposal-review-browser,mobile-running-browser}.png',
  )
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
