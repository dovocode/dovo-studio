import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const ui = `
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Choice=()=>null;export const Icon=()=>null;export const PullRequestIcon=()=>null;
export const ScreenHeader=({title,leading,actions})=><header>{title}{leading}{actions}</header>;
export const useTheme=()=>({colors:{},styles:{}});export const useSheetNavigation=()=>callback=>callback();
export const Markdown=({text})=><span>{text}</span>;export const formatTime=()=>'';
export const openAppLink=()=>{};export const readMobilePreferences=()=>({locale:'en',dateStyle:'relative'});
`
const boundaries = new Map([
  ...[
    'ui/content/text',
    'ui/controls/action',
    'ui/controls/choice',
    'ui/controls/icon',
    'ui/content/pull-request-icon',
    'ui/layout/screen-header',
    'ui/theme',
    'ui/layout/sheet',
    'ui/content/markdown',
    'ui/content/open-link',
    'runtime/preferences/app-preferences',
  ].map((path) => [mobile + path, ui]),
  [
    mobile + 'runtime/connection/provider',
    `import {createContext,useContext} from 'react';export const RuntimeContext=createContext(null);export const useRuntime=()=>useContext(RuntimeContext);`,
  ],
  [mobile + 'scm/pulls/list/create-pull', 'export const CreatePull=()=>null;'],
  [mobile + 'scm/pulls/detail/pull-comments', 'export const PullComments=()=>null;'],
  [mobile + 'scm/pulls/detail/pull-changes', 'export const PullChanges=()=>null;'],
  [mobile + 'scm/pulls/detail/line-comment', 'export const LineComment=()=>null;'],
  [mobile + 'scm/pulls/detail/pull-tabs', 'export const PullTabs=()=>null;'],
  [
    mobile + 'scm/pulls/detail/pull-status',
    'export const PullStatus=()=>null;export const Signal=()=>null;',
  ],
  [
    mobile + 'scm/pulls/list/pull-menu',
    `export const PullMenu=({onRefresh,refreshDisabled,onStartTask,taskDisabled})=><><button disabled={refreshDisabled} onClick={onRefresh}>Refresh PR</button><button disabled={taskDisabled} onClick={onStartTask}>Start task</button></>;`,
  ],
  [
    mobile + 'scm/pulls/list/pull-actions',
    `export const PullPrimaryAction=({option,onPress,disabled})=><button disabled={disabled} onClick={()=>onPress({action:option.action})}>{option.label}</button>;export const PullActionSheet=()=>null;`,
  ],
])
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {RegistryProvider} from '@effect/atom-react';import {Effect} from 'effect';
import {decode,snapshotSchema,pullDetailSchema,RuntimeRequestError} from '@dovo/protocol';
import {RuntimeContext} from './apps/mobile/src/runtime/connection/provider';import {NavigationContext} from './apps/mobile/src/shell/navigation';
import {PullDetail} from './apps/mobile/src/scm/pulls/detail/pull-detail';import {usePullDetail} from './apps/mobile/src/scm/pulls/detail/use-pull-detail';
import {usePulls} from './apps/mobile/src/scm/pulls/list/use-pulls';
window.calls=[];window.cacheWrites=[];window.writes=[];window.count=0;window.changedAccount=false;window.failOriginIdentity=!!window.initialLegacy;
const ids=['origin','matching','mismatch','legacy','wrong-repository','wrong-host'];
const profiles=ids.map(id=>({id,name:id,connection:{address:'http://'+id+'.lan:8787',token:'paired-'+id},createdAt:'2026-10-14T00:00:00Z'}));
const repository=id=>({id:'repo-'+id,name:id,path:'/checkout/'+id,branch:'main',pullIdentity:id==='origin'&&window.reboundOrigin?'github.com/team/rebound':id==='wrong-repository'?'github.com/other/project':id==='wrong-host'?'other.example/team/project':'github.com/team/project',forge:{connectionId:'local-'+id,repository:id==='origin'&&window.reboundOrigin?'team/rebound':'team/project',revision:'binding-'+id+(id==='origin'&&window.reboundOrigin?'-rebound':'')}});
const snapshot=id=>decode(snapshotSchema,{revision:1,owner:false,workspace:{version:1,runtimeAddress:'',repositories:[repository(id)],agents:[],automations:[],tasks:[]},approvals:[],questions:[],terminals:[],runs:[],devices:[],pendingDevices:[]});
const detail=id=>decode(pullDetailSchema,{destination:'destination-'+id,pull:{destination:'destination-'+id,connectionId:'local-'+id,provider:'github',number:7,title:'PR from '+id+' '+window.count,url:'https://github.com/team/project/pull/7',state:'open',draft:false,head:'feature',base:'main',author:'dominic',labels:[],updatedAt:'2026-10-14T10:00:00Z',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',body:'Body',additions:0,deletions:0,changedFiles:0,mergeable:true,reviewers:[],assignees:[]},capabilities:{actions:['comment'],mergeMethods:[],reviewDecisions:[]},comments:[],commits:[],files:[],checks:[],warnings:[]});
const data=new Map();const caches=new Map();const cache=profile=>{if(!caches.has(profile.id))caches.set(profile.id,{readEffect:key=>Effect.succeed(data.get(profile.id+key)),writeEffect:(key,value)=>Effect.sync(()=>{window.cacheWrites.push({owner:profile.id,key,value});data.set(profile.id+key,{value,cachedAt:'2026-10-14T10:00:00Z'})}),removeEffect:key=>Effect.sync(()=>data.delete(profile.id+key))});return caches.get(profile.id)};
const request=(profile,path,input,schema)=>Effect.tryPromise({try:async()=>{
const id=profile.id;window.calls.push({owner:id,path,input});
if(window.offline&&id==='origin')throw Error('Origin offline');
if(path.endsWith('/identity')){if(id==='legacy'||(id==='origin'&&window.failOriginIdentity))throw new RuntimeRequestError({kind:'response',status:501,message:'Endpoint not found'});return decode(schema,{readerIdentity:id==='mismatch'||id==='wrong-host'||(id==='matching'&&window.changedAccount)?'other-verified-account':'github-host-account',destination:'destination-'+id})}
if(window.dispatchRace===id&&input.expectedDestination!=='destination-'+id+'-rebound')throw Error('Destination changed');
if(input.expectedDestination!=='destination-'+id&&!(id==='origin'&&window.failOriginIdentity))throw Error('Missing destination guard');
if(input.repositoryId!=='repo-'+id)throw Error('Wrong repository id');
if(id!=='origin'&&input.connectionId)throw Error('Original connection id leaked');
if(input.expectedReaderIdentity!=='github-host-account'&&!(id==='origin'&&window.failOriginIdentity))throw Error('Missing read guard');
if(path.endsWith('/detail')){
 if(window.failedSection===input.section)throw Error(input.section+' temporarily unavailable');
 if(window.blockedSections?.includes(input.section))await new Promise(resolve=>(window.releaseSections??={})[input.section]=resolve);
 const value=detail(id);
 if(input.section==='overview'&&window.pushed)value.pull.headSha='c'.repeat(40);
 if(input.section==='changes') { value.pull.headSha=(window.pushed?'c':'a').repeat(40); value.files=[{path:'changed.ts',status:'added',additions:1,deletions:0,patch:'@@ -0,0 +1 @@\\n+new code'}]; }
 return value;
}
if(path.endsWith('/overview'))return decode(schema,{destination:'destination-'+id,pulls:[input.page===2?{...detail(id).pull,number:8,url:'https://github.com/team/project/pull/8'}:detail(id).pull],page:input.page,hasMore:input.page===1});
throw Error('Unexpected request '+path);
},catch:error=>error});
function Observe(){const [tab,setTab]=useState('overview');window.setObservedTab=setTab;const value=usePullDetail('repo-origin',7,window.explicitConnection??'local-origin',{tab});window.reader=value;return <output aria-label="observed">{value.detail?.pull.title}</output>}
function List(){const value=usePulls(window.listFilter??JSON.stringify(['origin','repo-origin']),'open');window.list=value;return <><output aria-label="list">{value.pages.map(page=>page.pulls.map(pull=>pull.title).join(',')).join(',')}</output><button disabled={value.busy||!value.pages[0]?.readConnected} onClick={()=>value.more(value.pages[0].sourceKey)}>More PRs</button></>}
function App(){const [binding,setBinding]=useState(false);window.rebind=()=>{window.reboundOrigin=true;setBinding(true)};const [offline,setOffline]=useState(false),[matching,setMatching]=useState(true),[mounted,setMounted]=useState(true),[version,setVersion]=useState(0),[detailShown,setDetailShown]=useState(!window.initialListOnly);window.setDetailShown=setDetailShown;window.offline=offline;window.setOffline=setOffline;window.setMatching=setMatching;window.setMounted=setMounted;window.remount=()=>setVersion(value=>value+1);
const overviews=profiles.map(profile=>({profile,snapshot:snapshot(profile.id),connected:profile.id==='origin'?!offline:profile.id==='matching'?matching:true}));
const value={profile:profiles[0],connection:profiles[0].connection,snapshot:overviews[0].snapshot,profiles,overviews,activeId:'origin',connected:!offline,readRuntimeEffect:request,readEffect:(...args)=>request(profiles[0],...args),readCache:cache(profiles[0]),cacheForRuntime:cache,callEffect:(path,input)=>Effect.sync(()=>window.writes.push({owner:'origin',path,input}))};
return <RuntimeContext value={value}><NavigationContext value={{focused:true}}>{mounted&&<div key={version}>{detailShown&&<><PullDetail repositoryId="repo-origin" number={7} connectionId={window.explicitConnection??'local-origin'} onBack={()=>{}}/><Observe/></>}<List/></div>}</NavigationContext></RuntimeContext>}
createRoot(document.getElementById('app')).render(<RegistryProvider><App/></RegistryProvider>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [
      root + 'packages/studio-core/node_modules',
      root + 'packages/studio-ui/node_modules',
    ],
    plugins: [
      {
        name: 'mobile-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /^\./ }, ({ path, importer }) => {
            const key = resolve(dirname(importer), path).replace(/\.tsx?$/, '')
            return boundaries.has(key) ? { path: key, namespace: 'mobile-boundary' } : undefined
          })
          builder.onLoad({ filter: /.*/, namespace: 'mobile-boundary' }, ({ path }) => ({
            contents: boundaries.get(path),
            loader: 'tsx',
            resolveDir: root,
          }))
        },
      },
    ],
  },
  [
    {
      path: 'react-native',
      contents: `export const Image=({source,style,onError,accessibilityLabel})=><img src={source.uri} style={style} onError={onError} alt={accessibilityLabel}/>;export const View=({children})=><div>{children}</div>;export const ScrollView=({children,refreshControl})=><div>{refreshControl}{children}</div>;export const Pressable=({children,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{children}</button>;export const RefreshControl=({onRefresh})=><button onClick={onRefresh}>Pull to refresh</button>;export const Keyboard={dismiss(){}};export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};`,
    },
    { path: 'expo-router', contents: 'export const router={push(){}};' },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.reader?.detail && window.list?.pages[0]?.pulls.length)
  await page.evaluate(() => {
    window.count++
    window.setOffline(true)
  })
  await page.waitForFunction(
    () =>
      window.reader?.detail?.pull.title.startsWith('PR from matching') &&
      window.list?.pages[0]?.pulls[0]?.title.startsWith('PR from matching'),
  )
  assert.equal(
    await page.getByRole('button', { name: 'Refresh PR', exact: true }).isEnabled(),
    true,
  )
  assert.equal(
    await page.getByRole('button', { name: 'Start task', exact: true }).isEnabled(),
    false,
  )
  assert.equal(await page.getByRole('button', { name: 'Comment', exact: true }).isEnabled(), false)
  await page
    .getByText('Reading from another runtime · actions require the original runtime.', {
      exact: true,
    })
    .waitFor()
  assert.equal(await page.getByRole('button', { name: 'More PRs', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: 'More PRs', exact: true }).click()
  await page.waitForFunction(() => window.list.pages[0]?.pulls.some((pull) => pull.number === 8))
  assert.equal(await page.evaluate(() => window.list.pages[0].readConnected), true)
  assert.equal(await page.evaluate(() => window.list.pages[0].runtimeId), 'origin')
  const pagination = await page.evaluate(() =>
    window.calls.find(
      (call) =>
        call.path.endsWith('/overview') && call.owner === 'matching' && call.input.page === 2,
    ),
  )
  assert.equal(pagination.input.repositoryId, 'repo-matching')
  assert.equal(pagination.input.expectedReaderIdentity, 'github-host-account')
  assert.equal(pagination.input.expectedDestination, 'destination-matching')
  const retained = await page.evaluate(() => ({
    detail: window.reader.detail,
    page: window.list.pages[0],
    writes: window.cacheWrites,
    calls: window.calls,
  }))
  assert.equal(retained.detail.destination, 'destination-origin')
  assert.equal(retained.detail.pull.destination, 'destination-origin')
  assert.equal(retained.detail.pull.connectionId, 'local-origin')
  assert.equal(retained.page.runtimeId, 'origin')
  assert.equal(retained.page.repositoryId, 'repo-origin')
  assert.equal(retained.page.connected, false)
  assert.equal(retained.page.pulls[0].destination, 'destination-origin')
  assert.ok(retained.writes.every((write) => write.owner === 'origin'))
  const routed = retained.calls.filter(
    (call) => call.owner === 'matching' && !call.path.endsWith('/identity'),
  )
  assert.ok(routed.some((call) => call.path.endsWith('/overview')))
  assert.ok(routed.some((call) => call.path.endsWith('/detail')))
  for (const call of routed) {
    assert.equal(call.input.repositoryId, 'repo-matching')
    assert.equal(call.input.expectedReaderIdentity, 'github-host-account')
    assert.equal(call.input.expectedDestination, 'destination-matching')
    assert.equal(call.input.connectionId, undefined)
  }
  await page.evaluate(() => window.count++)
  await page.getByRole('button', { name: 'Refresh PR', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('header').textContent.includes('PR from matching 2'),
  )
  await page.evaluate(() => {
    window.setMounted(false)
  })
  await page.waitForFunction(() => !document.querySelector('header'))
  await page.evaluate(() => window.setMounted(true))
  await page.waitForFunction(
    () =>
      window.reader?.readConnected &&
      window.reader.detail?.pull.title.startsWith('PR from matching'),
  )
  assert.equal(await page.evaluate(() => window.list.pages[0].runtimeId), 'origin')
  await page.evaluate(() => window.setMatching(false))
  await page.waitForFunction(() => !window.reader.readConnected && !window.list.connected)
  assert.equal(
    await page.getByRole('button', { name: 'Refresh PR', exact: true }).isEnabled(),
    false,
  )
  assert.equal(await page.getByRole('button', { name: 'Comment', exact: true }).isEnabled(), false)
  const rejected = await page.evaluate(() =>
    window.calls.filter(
      (call) =>
        ['mismatch', 'legacy', 'wrong-repository', 'wrong-host'].includes(call.owner) &&
        !call.path.endsWith('/identity'),
    ),
  )
  assert.deepEqual(rejected, [])
  // A candidate changing account between selection and dispatch must fail before reading.
  await page.evaluate(() => window.setMatching(true))
  await page.waitForFunction(() => window.reader.readConnected)
  const before = await page.evaluate(
    () =>
      window.calls.filter((call) => call.owner === 'matching' && call.path.endsWith('/detail'))
        .length,
  )
  await page.evaluate(() => (window.changedAccount = true))
  await page.getByRole('button', { name: 'Refresh PR', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'different account' }).first().waitFor()
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.owner === 'matching' && call.path.endsWith('/detail'))
          .length,
    ),
    before,
  )
  await page.evaluate(() => window.setOffline(false))
  await page.waitForFunction(() => window.reader.detail?.pull.title.startsWith('PR from origin'))
  assert.equal(await page.getByRole('button', { name: 'Comment', exact: true }).isEnabled(), true)
  assert.deepEqual(await page.evaluate(() => window.writes), [])
  // A verified list can authorize a detail first opened after the origin disconnects.
  const firstOpenPage = await browser.newPage()
  firstOpenPage.setDefaultTimeout(7000)
  firstOpenPage.on('pageerror', (error) => errors.push(error.message))
  await firstOpenPage.setContent('<div id="app"></div>')
  await firstOpenPage.evaluate(() => (window.initialListOnly = true))
  await firstOpenPage.addScriptTag({ content: built.outputFiles[0].text })
  await firstOpenPage.waitForFunction(() => window.list?.pages[0]?.pulls.length)
  await firstOpenPage.evaluate(() => window.setOffline(true))
  await firstOpenPage.waitForFunction(() =>
    window.list?.pages[0]?.pulls[0]?.title.startsWith('PR from matching'),
  )
  await firstOpenPage.evaluate(() => window.setDetailShown(true))
  await firstOpenPage.waitForFunction(() =>
    window.reader?.detail?.pull.title.startsWith('PR from matching'),
  )
  assert.equal(
    await firstOpenPage.evaluate(() => window.reader.detail.destination),
    'destination-origin',
  )
  assert.equal(
    await firstOpenPage.evaluate(() => window.reader.detail.pull.connectionId),
    'local-origin',
  )
  assert.equal(
    await firstOpenPage.getByRole('button', { name: 'Refresh PR', exact: true }).isEnabled(),
    true,
  )
  assert.equal(
    await firstOpenPage.getByRole('button', { name: 'Comment', exact: true }).isEnabled(),
    false,
  )
  const firstOpenReads = await firstOpenPage.evaluate(
    () => window.calls.filter((call) => call.path.endsWith('/detail')).length,
  )
  await firstOpenPage.evaluate(() => window.setDetailShown(false))
  await firstOpenPage.waitForFunction(() => !document.querySelector('header'))
  await firstOpenPage.evaluate(() => {
    window.explicitConnection = 'another-origin-account'
    window.setDetailShown(true)
  })
  await firstOpenPage.getByRole('button', { name: 'Refresh details', exact: true }).waitFor()
  assert.equal(
    await firstOpenPage.getByRole('button', { name: 'Refresh details', exact: true }).isEnabled(),
    false,
  )
  assert.equal(await firstOpenPage.evaluate(() => window.reader.readConnected), false)
  assert.equal(
    await firstOpenPage.evaluate(
      () => window.calls.filter((call) => call.path.endsWith('/detail')).length,
    ),
    firstOpenReads,
  )
  const legacyPage = await browser.newPage()
  legacyPage.setDefaultTimeout(7000)
  legacyPage.on('pageerror', (error) => errors.push(error.message))
  await legacyPage.setContent('<div id="app"></div>')
  await legacyPage.evaluate(() => (window.initialLegacy = true))
  await legacyPage.addScriptTag({ content: built.outputFiles[0].text })
  await legacyPage.waitForFunction(
    () => window.reader?.detail && window.list?.pages[0]?.pulls.length,
  )
  await legacyPage.evaluate(() => window.setOffline(true))
  await legacyPage.waitForFunction(() => !window.reader.readConnected && !window.list.connected)
  assert.equal(
    await legacyPage.getByRole('button', { name: 'Refresh PR', exact: true }).isEnabled(),
    false,
  )
  assert.deepEqual(
    await legacyPage.evaluate(() =>
      window.calls.filter((call) => call.owner !== 'origin' && !call.path.endsWith('/identity')),
    ),
    [],
  )
  assert.equal(
    await legacyPage.evaluate(() => window.reader.detail.pull.destination),
    'destination-origin',
  )
  const rebound = await browser.newPage()
  rebound.setDefaultTimeout(7000)
  rebound.on('pageerror', (error) => errors.push(error.message))
  await rebound.setContent('<div id="app"></div>')
  await rebound.evaluate(() => {
    window.initialListOnly = true
    window.listFilter = ''
  })
  await rebound.addScriptTag({ content: built.outputFiles[0].text })
  await rebound.waitForFunction(() =>
    window.list?.pages.some((p) => p.runtimeId === 'origin' && p.pulls.length),
  )
  await rebound.evaluate(() => window.setOffline(true))
  await rebound.waitForFunction(() =>
    window.list.pages.some(
      (p) => p.runtimeId === 'origin' && p.pulls[0]?.title.startsWith('PR from matching'),
    ),
  )
  await rebound.evaluate(() => {
    window.cacheWrites = []
    window.rebind()
  })
  await rebound.waitForFunction(
    () =>
      window.list.pages.some((p) => p.runtimeId === 'matching' && p.pulls.length) &&
      !window.list.busy,
  )
  const reboundPages = await rebound.evaluate(() => window.list.pages)
  assert.equal(
    new Set(reboundPages.map((p) => p.sourceKey)).size,
    reboundPages.length,
    'No origin key owns two remotes after rebind',
  )
  const originalRemote = reboundPages.find((p) => p.runtimeId === 'matching')
  assert.equal(originalRemote.repositoryId, 'repo-matching')
  assert.equal(originalRemote.pulls[0].destination, 'destination-matching')
  assert.equal(
    originalRemote.sourceKey,
    JSON.stringify(['matching', 'repo-matching']),
    'Row navigation uses the current matching source',
  )
  assert.equal(
    reboundPages.some((p) => p.runtimeId === 'origin' && p.pulls.length),
    false,
    'Rebound origin must not display the old remote under its new cache/navigation identity',
  )
  assert.equal(
    await rebound.evaluate(() =>
      window.cacheWrites.some((w) => w.owner === 'origin' && w.value.pulls?.length),
    ),
    false,
  )
  await rebound.close()
  const race = await browser.newPage()
  race.setDefaultTimeout(7000)
  race.on('pageerror', (error) => errors.push(error.message))
  await race.setContent('<div id="app"></div>')
  await race.evaluate(() => (window.initialListOnly = true))
  await race.addScriptTag({ content: built.outputFiles[0].text })
  await race.waitForFunction(() => window.list?.pages[0]?.pulls.length && !window.list.busy)
  await race.evaluate(() => window.setOffline(true))
  await race.waitForFunction(
    () => window.list.pages[0]?.pulls[0]?.title.startsWith('PR from matching') && !window.list.busy,
  )
  await race.evaluate(() => {
    window.cacheWrites = []
    window.dispatchRace = 'matching'
  })
  await race.getByRole('button', { name: 'More PRs', exact: true }).click()
  await race.waitForFunction(() => window.list.pages[0]?.error?.includes('Destination changed'))
  assert.equal(await race.evaluate(() => window.list.pages[0].pulls.length), 1)
  assert.deepEqual(
    await race.evaluate(() => window.cacheWrites),
    [],
    'Rejected pagination cannot publish data into the origin cache',
  )
  await race.close()
  const sectionsPage = await browser.newPage()
  sectionsPage.on('pageerror', (error) => errors.push(error.message))
  await sectionsPage.setContent('<div id="app"></div>')
  await sectionsPage.evaluate(() => {
    window.blockedSections = ['stack', 'checks', 'changes']
  })
  await sectionsPage.addScriptTag({ content: built.outputFiles[0].text })
  await sectionsPage.waitForFunction(
    () => window.reader?.detail?.pull.body === 'Body' && window.reader.sections.status.ready,
  )
  assert.equal(
    await sectionsPage.evaluate(() =>
      window.calls.some((call) => ['checks', 'changes'].includes(call.input.section)),
    ),
    false,
  )
  await sectionsPage.evaluate(() => window.setObservedTab('changes'))
  await sectionsPage.waitForFunction(() => !!window.releaseSections?.changes)
  assert.equal(await sectionsPage.evaluate(() => window.reader.detail.pull.body), 'Body')
  assert.equal(await sectionsPage.evaluate(() => window.reader.sections.changes.ready), false)
  await sectionsPage.evaluate(() => {
    window.blockedSections = ['stack', 'checks']
    window.releaseSections.changes()
  })
  await sectionsPage.waitForFunction(() => window.reader.detail.files[0]?.path === 'changed.ts')
  await sectionsPage.evaluate(() => {
    window.failedSection = 'checks'
    window.setObservedTab('checks')
  })
  await sectionsPage.waitForFunction(() =>
    window.reader.sections.checks.error.includes('temporarily unavailable'),
  )
  assert.equal(await sectionsPage.evaluate(() => window.reader.detail.pull.body), 'Body')
  assert.equal(await sectionsPage.evaluate(() => window.reader.detail.files[0]?.path), 'changed.ts')
  await sectionsPage.evaluate(() => {
    window.failedSection = undefined
    window.blockedSections = ['stack']
    window.reader.sections.checks.refresh()
  })
  await sectionsPage.waitForFunction(
    () => window.reader.sections.checks.ready && !window.reader.sections.checks.error,
  )
  // A section sees a push first: the overview follows; old-revision files never leak through.
  await sectionsPage.evaluate(() => {
    window.pushed = true
    window.setObservedTab('changes')
    window.reader.sections.changes.refresh()
  })
  await sectionsPage.waitForFunction(
    () =>
      window.reader.detail.pull.headSha === 'c'.repeat(40) && window.reader.sections.changes.ready,
  )
  assert.equal(await sectionsPage.evaluate(() => window.reader.detail.files[0]?.path), 'changed.ts')
  await sectionsPage.close()
  assert.deepEqual(errors, [])
  console.log(
    'Mobile PR handoff passed: filtered list and actual detail UI use same-repository verified reader; refresh enabled with writes disabled; original cache/destinations/connection retained; remote rebind invalidates origin association; rejected pagination cannot publish caches; remount and reconnect; mismatched, unverified, other-repository/host and changed-account readers rejected. Native presentation and runtime transport mocked; no provider writes.',
  )
} finally {
  await browser.close()
}
