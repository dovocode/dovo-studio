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
  [mobile + 'scm/pulls/detail/linked-threads', 'export const PullLinkedThreads=()=>null;'],
  [mobile + 'scm/pulls/detail/pull-comments', 'export const PullComments=()=>null;'],
  [
    mobile + 'scm/pulls/detail/pull-changes',
    `import {useState,useEffect} from 'react';export function PullChanges({detail,active}){const [selected,setSelected]=useState('changed.ts');useEffect(()=>{window.changesMounts=(window.changesMounts??0)+1},[]);return <section aria-label="Files probe" data-active={active}><output>{selected}</output><button onClick={()=>setSelected('second.ts')}>Select second file</button><span>{detail.stale?'read-only':'current'}</span></section>}`,
  ],
  [mobile + 'scm/pulls/detail/line-comment', 'export const LineComment=()=>null;'],
  [
    mobile + 'scm/pulls/detail/pull-tabs',
    `export const PullTabs=({items,onChange,value})=><nav>{items.map(item=><button key={item.id} aria-pressed={value===item.id} onClick={()=>onChange(item.id)}>{item.name}</button>)}</nav>;`,
  ],
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
if(path.endsWith('/identity')){if(id==='legacy'||(id==='origin'&&window.failOriginIdentity))throw new RuntimeRequestError({kind:'response',status:501,message:'Endpoint not found'});return decode(schema,{readerIdentity:id==='mismatch'||id==='wrong-host'||(id==='origin'&&window.changedAccount)?'other-verified-account':'github-host-account',destination:'destination-'+id})}
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
 if(window.linkedComment&&input.section==='discussion')value.comments=[{id:'linked',kind:'comment',body:'Linked feedback',url:value.pull.url+'#linked',author:'reviewer',date:''}];
 if(input.section==='changes') { if(window.changesWarning)value.warnings=['Incomplete patch']; value.pull.headSha=(window.pushed?'c':'a').repeat(40); value.files=[{path:'changed.ts',status:'added',additions:1,deletions:0,patch:'@@ -0,0 +1 @@\\n+new code'}]; }
 return value;
}
if(path.endsWith('/overview')&&window.simulatedPages?.[id])return decode(schema,{destination:'destination-'+id,pulls:[{...detail(id).pull,number:window.simulatedPages[id].number}],page:1,hasMore:false,cachedAt:window.simulatedPages[id].cachedAt,stale:window.simulatedPages[id].stale});if(path.endsWith('/overview'))return decode(schema,{destination:'destination-'+id,pulls:[input.page===2?{...detail(id).pull,number:8,url:'https://github.com/team/project/pull/8'}:detail(id).pull],page:input.page,hasMore:input.page===1});
throw Error('Unexpected request '+path);
},catch:error=>error});
function Observe(){const [tab,setTab]=useState('overview');window.setObservedTab=setTab;const value=usePullDetail('repo-origin',7,window.explicitConnection??'local-origin',{tab});window.reader=value;return <output aria-label="observed">{value.detail?.pull.title}</output>}
function List(){const value=usePulls(window.listFilter??JSON.stringify(['origin','repo-origin']),'open');window.list=value;return <><output aria-label="list">{value.pages.map(page=>page.pulls.map(pull=>pull.title).join(',')).join(',')}</output><button disabled={value.busy||!value.pages[0]?.readConnected} onClick={()=>value.more(value.pages[0].sourceKey)}>More PRs</button></>}
function App(){const [binding,setBinding]=useState(false);window.rebind=()=>{window.reboundOrigin=true;setBinding(true)};const [offline,setOffline]=useState(false),[matching,setMatching]=useState(true),[mounted,setMounted]=useState(true),[version,setVersion]=useState(0),[detailShown,setDetailShown]=useState(!window.initialListOnly);window.setDetailShown=setDetailShown;window.offline=offline;window.setOffline=setOffline;window.setMatching=setMatching;window.setMounted=setMounted;window.remount=()=>setVersion(value=>value+1);
const overviews=profiles.map(profile=>({profile,snapshot:snapshot(profile.id),connected:profile.id==='origin'?!offline:profile.id==='matching'?matching:true}));
const value={profile:profiles[0],connection:profiles[0].connection,snapshot:overviews[0].snapshot,profiles,overviews,activeId:'origin',connected:!offline,readRuntimeEffect:request,readEffect:(...args)=>request(profiles[0],...args),readCache:cache(profiles[0]),cacheForRuntime:cache,callEffect:(path,input)=>Effect.sync(()=>window.writes.push({owner:'origin',path,input}))};
return <RuntimeContext value={value}><NavigationContext value={{focused:true}}>{mounted&&<div key={version}>{detailShown&&<><PullDetail initialFragment={window.linkedComment?'#linked':''} repositoryId="repo-origin" number={7} connectionId={window.explicitConnection??'local-origin'} onBack={()=>{}}/><Observe/></>}<List/></div>}</NavigationContext></RuntimeContext>}
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
  const noPeerReads = async (target) =>
    assert.deepEqual(
      await target.evaluate(() =>
        window.calls.filter((call) => call.owner !== 'origin' && !call.path.endsWith('/identity')),
      ),
      [],
      'PR requests must stay on the selected machine, even with a same-account peer available',
    )
  await noPeerReads(page)
  await page.getByRole('button', { name: 'More PRs', exact: true }).click()
  await page.waitForFunction(() => window.list.pages[0]?.pulls.some((pull) => pull.number === 8))
  const pagination = await page.evaluate(() =>
    window.calls.find((call) => call.owner === 'origin' && call.input.page === 2),
  )
  assert.equal(pagination.input.expectedReaderIdentity, 'github-host-account')
  assert.equal(pagination.input.expectedDestination, 'destination-origin')
  await page.evaluate(() => window.setOffline(true))
  await page.waitForFunction(() => !window.reader.readConnected && !window.list.connected)
  assert.equal(await page.evaluate(() => window.reader.detail.stale), true)
  assert.equal(await page.evaluate(() => window.list.pages[0].stale), true)
  for (const name of ['Refresh PR', 'Start task', 'Comment', 'More PRs'])
    assert.equal(await page.getByRole('button', { name, exact: true }).isEnabled(), false)
  await page.evaluate(() => window.setMounted(false))
  await page.waitForFunction(() => !document.querySelector('header'))
  await page.evaluate(() => window.setMounted(true))
  await page.waitForFunction(() => window.reader?.detail && window.list?.pages[0]?.pulls.length)
  assert.equal(await page.evaluate(() => window.reader.detail.pull.title), 'PR from origin 0')
  assert.equal(await page.evaluate(() => window.reader.detail.stale), true)
  await noPeerReads(page)
  await page.evaluate(() => {
    window.count++
    window.setOffline(false)
  })
  await page.waitForFunction(
    () => window.reader.detail?.pull.title === 'PR from origin 1' && !window.reader.detail.stale,
  )
  await noPeerReads(page)
  // An offline list does not authorize an alternate machine for a detail opened for the first time.
  const firstOpenPage = await browser.newPage()
  await firstOpenPage.setContent('<div id="app"></div>')
  await firstOpenPage.evaluate(() => (window.initialListOnly = true))
  await firstOpenPage.addScriptTag({ content: built.outputFiles[0].text })
  await firstOpenPage.waitForFunction(() => window.list?.pages[0]?.pulls.length)
  await firstOpenPage.evaluate(() => {
    window.setOffline(true)
    window.setDetailShown(true)
  })
  await firstOpenPage.waitForFunction(() => window.reader && !window.reader.readConnected)
  assert.equal(await firstOpenPage.evaluate(() => window.reader.detail), null)
  await noPeerReads(firstOpenPage)
  await firstOpenPage.close()
  // Changing credentials on the selected machine cannot silently switch an open PR to a new account.
  const reads = await page.evaluate(
    () => window.calls.filter((call) => call.path.endsWith('/detail')).length,
  )
  await page.evaluate(() => {
    window.changedAccount = true
    window.reader.refresh()
  })
  await page.waitForFunction(() => !!window.reader.error && !window.reader.busy)
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.path.endsWith('/detail')).length),
    reads,
  )
  await noPeerReads(page)
  // A legacy runtime is readable locally, but cannot authorize an alternate.
  const legacy = await browser.newPage()
  await legacy.setContent('<div id="app"></div>')
  await legacy.evaluate(() => (window.initialLegacy = true))
  await legacy.addScriptTag({ content: built.outputFiles[0].text })
  await legacy.waitForFunction(() => window.reader?.detail && window.list?.pages[0]?.pulls.length)
  await legacy.evaluate(() => window.setOffline(true))
  await legacy.waitForFunction(() => !window.reader.readConnected)
  await noPeerReads(legacy)
  await legacy.close()
  const sectionsPage = await browser.newPage()
  sectionsPage.on('pageerror', (error) => errors.push(error.message))
  await sectionsPage.setContent('<div id="app"></div>')
  await sectionsPage.evaluate(() => {
    window.blockedSections = ['stack', 'checks', 'changes']
  })
  await sectionsPage.clock.install()
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
  const pinnedReads = await sectionsPage.evaluate(
    () => window.calls.filter((x) => x.input.section === 'changes').length,
  )
  const overviewReads = await sectionsPage.evaluate(
    () => window.calls.filter((x) => x.input.section === 'overview').length,
  )
  await sectionsPage.clock.fastForward(31000)
  await sectionsPage.waitForFunction(
    (count) => window.calls.filter((x) => x.input.section === 'overview').length > count,
    overviewReads,
  )
  assert.equal(
    await sectionsPage.evaluate(
      () => window.calls.filter((x) => x.input.section === 'changes').length,
    ),
    pinnedReads,
  )
  // A partial response must keep polling until a clean pinned revision is received.
  await sectionsPage.evaluate(() => {
    window.changesWarning = true
    window.reader.sections.changes.refresh()
  })
  await sectionsPage.waitForFunction(() =>
    window.reader.sections.changes.detail.warnings.includes('Incomplete patch'),
  )
  const partialReads = await sectionsPage.evaluate(
    () => window.calls.filter((x) => x.input.section === 'changes').length,
  )
  await sectionsPage.evaluate(() => {
    window.changesWarning = false
  })
  await sectionsPage.clock.fastForward(11000)
  await sectionsPage.waitForFunction(
    (count) =>
      window.calls.filter((x) => x.input.section === 'changes').length > count &&
      !window.reader.sections.changes.detail.warnings.length,
    partialReads,
  )
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
  const cachePage = await browser.newPage()
  cachePage.setDefaultTimeout(7000)
  cachePage.on('pageerror', (error) => errors.push(error.message))
  await cachePage.setContent('<div id="app"></div>')
  await cachePage.evaluate(() => {
    window.initialListOnly = true
    window.simulatedPages = {
      origin: { number: 608, cachedAt: '2026-10-19T08:39:00Z', stale: true },
      matching: { number: 614, cachedAt: '2026-10-20T11:45:00Z', stale: false },
    }
  })
  await cachePage.addScriptTag({ content: built.outputFiles[0].text })
  await cachePage.waitForFunction(
    () => window.list?.pages[0]?.pulls[0]?.number === 608 && !window.list.busy,
  )
  await cachePage.evaluate(() => {
    window.simulatedPages.origin = { number: 614, cachedAt: '2026-10-20T11:45:00Z', stale: false }
    window.list.refresh()
  })
  await cachePage.waitForFunction(
    () => window.list.pages[0]?.pulls[0]?.number === 614 && !window.list.busy,
  )
  await cachePage.evaluate(() => {
    window.simulatedPages.origin = { number: 608, cachedAt: '2026-10-19T08:39:00Z', stale: true }
    window.list.refresh()
  })
  await cachePage.waitForFunction(
    () => !window.list.busy && window.list.pages[0].error?.includes('newer saved PR data'),
  )
  assert.equal(await cachePage.evaluate(() => window.list.pages[0].pulls[0].number), 614)
  await noPeerReads(cachePage)
  const lastSaved = await cachePage.evaluate(
    () => window.cacheWrites.filter((write) => JSON.parse(write.key)[0] === 'pulls').at(-1).value,
  )
  assert.equal(lastSaved.pulls[0].number, 614)
  await cachePage.close()
  // The mobile detail keeps its mounted file view and selection while a pushed diff loads.
  const layout = await browser.newPage()
  layout.on('pageerror', (error) => errors.push(error.message))
  await layout.setContent('<div id="app"></div>')
  await layout.addScriptTag({ content: built.outputFiles[0].text })
  await layout.getByRole('button', { name: 'Files', exact: true }).click()
  await layout.getByRole('button', { name: 'Select second file', exact: true }).click()
  await layout.evaluate(() => {
    window.blockedSections = ['changes']
    window.pushed = true
  })
  await layout.getByRole('button', { name: 'Refresh PR', exact: true }).click()
  await layout
    .getByText('Updating files · showing the previous revision read-only.', { exact: true })
    .waitFor()
  const files = layout.getByRole('region', { name: 'Files probe' })
  assert.equal(await files.getAttribute('data-active'), 'false')
  await files.getByText('second.ts', { exact: true }).waitFor()
  assert.equal(await layout.evaluate(() => window.changesMounts), 1)
  await layout.evaluate(() => {
    window.blockedSections = []
    window.releaseSections.changes()
  })
  await layout
    .getByText('Updating files · showing the previous revision read-only.', { exact: true })
    .waitFor({ state: 'hidden' })
  await files.getByText('second.ts', { exact: true }).waitFor()
  assert.equal(await layout.evaluate(() => window.changesMounts), 1)
  await layout.close()
  // A linked comment must not force Activity back open after the user selects Overview.
  const linked = await browser.newPage()
  linked.on('pageerror', (error) => errors.push(error.message))
  await linked.setContent('<div id="app"></div>')
  await linked.evaluate(() => (window.linkedComment = true))
  await linked.addScriptTag({ content: built.outputFiles[0].text })
  await linked.getByRole('button', { name: 'Activity', exact: true }).click()
  await linked.getByRole('button', { name: 'Overview', exact: true }).click()
  await linked.getByRole('button', { name: 'Refresh PR', exact: true }).click()
  await linked.getByText('PR from origin 0', { exact: true }).last().waitFor()
  // The visible overview metadata proves that the refreshed linked comment did not redirect the tab.
  assert.equal(
    await linked
      .getByRole('button', { name: 'Overview', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  )
  await linked.close()
  assert.deepEqual(errors, [])
  console.log(
    'Mobile PR selected-source checks passed: same-account peers never take over; offline/remount/reconnect, account replacement, legacy reads, guarded pagination, newer cache retention, independent sections, pushed-diff selection and linked-tab stability. Native presentation and transport mocked; no provider writes.',
  )
} finally {
  await browser.close()
}
