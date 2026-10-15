import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = root + '/packages/studio-ui/src'
const mobile = root + '/apps/mobile/src'
const built = await bundleBrowser(
  {
    stdin: {
      loader: 'tsx',
      resolveDir: root,
      contents: `import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useCallback,useEffect,useState} from 'react';
import {decode,forgePipelineDetailSchema} from '@dovo/protocol';
import {usePipelineSections} from '${mobile}/scm/work/use-pipeline-sections.ts';
import {PipelineRunInfo,PipelineJobs} from '${mobile}/scm/pulls/detail/pipeline-details.tsx';
import {PipelineSectionStatus} from '${mobile}/scm/work/pipeline-section-status.tsx';
import {PullPipelineRuns} from '${root}/packages/extension-scm/src/pulls/detail/pipeline-runs.tsx';
const run={id:'run-1',number:'1',title:'PR build',url:'https://github.com/team/project/actions/runs/1',status:'failure',attempt:1,sha:'commit',ref:'feature',workflow:'Build',updatedAt:'2026-10-14',createdAt:'2026-10-14',actor:'Dominic'};
const job={id:'job-1',name:'Build job',status:'success',startedAt:'2026-10-14T10:00:00Z',completedAt:'2026-10-14T10:02:14Z',url:run.url+'/job/1',steps:[{id:'step-1',number:1,name:'Compile source',status:'success'}]};
window.blocked=[];window.failed=[];window.releases={};window.run=run;window.release=section=>{window.blocked=window.blocked.filter(s=>s!==section);for(const done of window.releases[section]??[])done();window.releases[section]=[]};
window.reads=[];window.store={connected:true,activeRuntimeId:'owner',runtimes:[],connection:{address:'http://owner.local'},workspace:{repositories:[{id:'repo',name:'Project',forge:{connectionId:'account-1',repository:'team/project'}}]},request:async(path,input)=>{
window.reads.push({path,input});
if(path==='/api/scm/source/identity')return {readerIdentity:'fixture-account',destination:'fixture-destination'};
const section=input.section??(path.endsWith('/options')?'options':'other');
if(window.blocked.includes(section))await new Promise(resolve=>(window.releases[section]??=[]).push(resolve));
if(window.failed.includes(section))throw new Error(section+' temporarily unavailable');
if(path.endsWith('/options'))return {provider:'github',pipelines:true,issues:false,pipelineActions:[],pipelineDefinitions:[]};
if(path.endsWith('/pipelines/list'))return {items:[run]};
if(path.endsWith('/pipelines/detail'))return {run:{...run},jobs:input.section==='jobs'?(input.cursor?[{...job,id:'job-2',name:'Publish job',status:'failure',steps:[{id:'step-2',number:1,name:'Upload artifact',status:'failure'}]}]:[job]):[],next:input.section==='jobs'&&!input.cursor?'2':undefined,graph:input.section==='graph'?[{id:'build',name:'Build job',needs:[],jobIds:[]},{id:'publish',name:'Publish job',needs:['build'],jobIds:[]}]:undefined};
throw new Error('Unexpected request '+path);
}};
const saved=window.saved=new Map();window.store.readCache={read:async(key,schema)=>{const row=saved.get(key);return row?{...row,value:decode(schema,row.value)}:null},write:async(key,value)=>{saved.set(key,{value:structuredClone(value),cachedAt:'2026-10-14'})},remove:async key=>{saved.delete(key)}};
function Mobile(){const[overview,setOverview]=useState(window.mobileOverview),[revision,setRevision]=useState(0);const load=useCallback(async(section,cursor,refresh,revision)=>decode(forgePipelineDetailSchema,await window.store.request('/api/scm/work/pipelines/detail',{section,cursor,refresh,revision})),[]);const sections=usePipelineSections({overview,enabled:window.active&&window.store.connected,readCache:window.store.readCache,cacheKey:'mobile-run',refreshToken:revision,load,refreshOverview:()=>setOverview({run:{...run},jobs:[]})});window.mobileSections=sections;return <div aria-label="Mobile pipeline" style={{display:'flex',flexDirection:'column',gap:20,padding:16,maxWidth:600,margin:'auto'}}><PipelineRunInfo run={overview.run}/><PipelineSectionStatus label="Jobs" state={sections.jobs} connected={window.store.connected}/><PipelineSectionStatus label="Workflow" state={sections.graph} connected={window.store.connected}/><PipelineJobs jobs={sections.detail.jobs} graph={sections.detail.graph} hasMore={!!sections.detail.next} ready={sections.jobs.ready} onOpen={()=>{}}/>{sections.detail.next&&<button onClick={sections.jobs.more}>More jobs</button>}</div>}
const app=createRoot(document.getElementById('app'));window.active=true;window.mount=()=>flushSync(()=>app.render(window.empty?<p>Unmounted</p>:window.mobile?<Mobile key={window.mobileKey??0}/>:<div hidden={!window.active}><PullPipelineRuns repositoryId="repo" sha="commit" active={window.active}/></div>));window.mount();`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '@dovo/protocol';export {startPolling} from '${root}/packages/client-runtime/src/effects/polling.ts';export {appendUniqueRows,RequestScope} from '${root}/packages/client-runtime/src/effects/request-scope.ts';const sources=[];export const useRepositorySources=()=>sources;export const useWorkspace=()=>window.store;export const formatDateTime=(x,options)=>new Intl.DateTimeFormat('en',{...options}).format(new Date(x));`,
    },
    {
      path: 'react-native',
      contents: `const flat=s=>{const value=Object.assign({},...(Array.isArray(s)?s.flat(Infinity):[s]));if(typeof value.lineHeight==='number')value.lineHeight=value.lineHeight+'px';return value};export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',flexShrink:0,...flat(style)}}>{children}</div>;export const ScrollView=({children,contentContainerStyle,horizontal})=><div style={{overflowX:'auto'}}><div style={{display:'flex',flexDirection:horizontal?'row':'column',width:horizontal?'max-content':undefined,...flat(contentContainerStyle)}}>{children}</div></div>;export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole==='alert'?'alert':undefined} style={flat(style)}>{children}</span>;export const Pressable=({children,onPress,style,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress} style={{textAlign:'left',...flat(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;const listeners=new Set();export const AppState=window.nativeState={currentState:'active',addEventListener:(_event,listener)=>{listeners.add(listener);return {remove:()=>listeners.delete(listener)}},change:value=>{window.nativeState.currentState=value;for(const listener of listeners)listener(value)}};`,
    },
    ...['../../runtime/state/application-state', '../../../runtime/state/application-state'].map(
      (path) => ({
        path,
        importer: mobile + '/scm/',
        contents: `export {useState as useApplicationState} from 'react';`,
      }),
    ),
    {
      path: '../../../shell/navigation',
      importer: mobile + '/scm/pulls/',
      contents: `export const useNavigation=()=>({focused:window.active});`,
    },
    ...['../../ui/theme', '../../../ui/theme'].map((path) => ({
      path,
      importer: mobile + '/scm/',
      contents: `export const useTheme=()=>({colors:{text:'#e9e9ef',surface:'#1c1c23',elevated:'#25252e',background:'#141419',muted:'#aaaab7',border:'#393943',accent:'#ad9cfa',error:'#ff7e97',success:'#8ad5b0',warning:'#e7c681'},styles:{text:{color:'#e9e9ef',fontSize:16,lineHeight:'22px'},muted:{color:'#aaaab7',fontSize:13,lineHeight:'18px'},title:{color:'#e9e9ef',fontWeight:700},error:{color:'#ff7e97',fontSize:13},row:{display:'flex',flexDirection:'row',alignItems:'center',gap:6,flexWrap:'wrap'},card:{border:'1px solid #393943',borderRadius:12,padding:12,background:'#1c1c23',gap:8}}});`,
    })),
    ...['../../ui/content/text', '../../../ui/content/text'].map((path) => ({
      path,
      importer: mobile + '/scm/',
      contents: `export {Text} from 'react-native';`,
    })),
    ...['../../ui/controls/action', '../../../ui/controls/action'].map((path) => ({
      path,
      importer: mobile + '/scm/',
      contents: `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    })),
    {
      path: '../../../ui/controls/icon',
      importer: mobile + '/scm/pulls/',
      contents: `export const Icon=()=>null;`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents:
        ['button', 'input', 'dialog']
          .map((name) => `export * from '${ui}/components/ui/${name}.tsx';`)
          .join('') +
        `export {PageHeader} from '${ui}/page-header.tsx';export {ChoicePicker} from '${ui}/choice-picker.tsx';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';`,
    },
    {
      path: './work-form',
      importer: root + '/packages/extension-scm/src/work/content.tsx',
      contents: 'export const WorkForm=()=>null;',
    },
    {
      path: './issue-detail',
      importer: root + '/packages/extension-scm/src/work/content.tsx',
      contents: 'export const IssueDetail=()=>null;',
    },
    {
      path: './work-task-links',
      importer: root + '/packages/extension-scm/src/work/pipeline-detail.tsx',
      contents: 'export const WorkTaskLinks=()=>null;',
    },
  ],
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.install()
  await page.setContent(
    '<html class="dark"><body style="font-family:system-ui"><div id="app" style="max-width:1100px;margin:24px auto"></div></body></html>',
  )
  const assets = root + '/apps/desktop/dist/assets'
  for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + file, 'utf8') })
  const screenshots = '/tmp/dovo-pipelines'
  await mkdir(screenshots, { recursive: true })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate(() => {
    window.blocked = ['jobs', 'graph', 'options']
  })
  await page.getByRole('button').filter({ hasText: 'PR build' }).click()
  await page.getByRole('heading', { name: 'PR build', exact: true }).waitFor()
  await page.getByText('Loading jobs…', { exact: true }).waitFor()
  assert.equal(await page.locator('[aria-label="Pipeline jobs"]').count(), 0)
  await page.evaluate(() => {
    window.failed = ['jobs']
    window.release('jobs')
  })
  await page.getByText('Jobs: jobs temporarily unavailable', { exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'PR build', exact: true }).count(), 1)
  await page.evaluate(() => {
    window.failed = []
    window.release('graph')
    window.release('options')
  })
  await page.getByRole('button', { name: 'Refresh jobs', exact: true }).click()
  const job = page.getByRole('button').filter({ hasText: 'Build job' }).last()
  await job.click()
  await page.getByText('Compile source', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Back to pipelines' }).count(), 0)
  await page.getByRole('button', { name: 'Back to runs', exact: true }).waitFor()
  assert.equal(await page.locator('.studio-page-header[data-embedded=true]').count(), 1)
  assert.equal(await page.locator('[data-window-edge]').count(), 0)

  await page.evaluate(() => {
    window.active = false
    window.mount()
  })
  // Commit the inactive render and effect cleanup before advancing polling timers.
  assert.equal(await job.isVisible(), false, 'Checks must be hidden before advancing the clock')
  const readsWhileHidden = await page.evaluate(() => window.reads.length)
  await page.clock.runFor(31000)
  assert.equal(
    await page.evaluate(() => window.reads.length),
    readsWhileHidden,
    'hidden Checks kept polling',
  )
  await page.evaluate(() => {
    window.active = true
    window.mount()
  })
  await page.getByText('Compile source', { exact: true }).waitFor()
  assert.equal(
    await job.getAttribute('aria-expanded'),
    'true',
    'returning to Checks reset job expansion',
  )
  const listReads = await page.evaluate(
    () => window.reads.filter((read) => read.path.endsWith('/pipelines/list')).length,
  )
  await page.clock.runFor(10010)
  await page.waitForFunction(
    (before) =>
      window.reads.filter((read) => read.path.endsWith('/pipelines/list')).length > before,
    listReads,
  )
  assert.equal(await job.getAttribute('aria-expanded'), 'true', 'summary polling reset job context')
  await page.evaluate(() => {
    window.store.request = window.store.request.bind(null)
    window.mount()
  })
  await page.getByText('Compile source', { exact: true }).waitFor()
  assert.equal(
    await job.getAttribute('aria-expanded'),
    'true',
    'request identity change reset the preview',
  )
  await page.getByRole('button', { name: 'More jobs', exact: true }).click()
  await page.getByText('Upload artifact', { exact: true }).waitFor()
  await page.screenshot({ path: screenshots + '/desktop-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Narrow pipeline overflowed',
  )
  await page.screenshot({ path: screenshots + '/desktop-narrow.png', fullPage: true })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.screenshot({ path: screenshots + '/desktop-light.png', fullPage: true })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  // Remount entirely offline: overview and both loaded pages survive on the device.
  await page.evaluate(() => {
    window.empty = true
    window.mount()
  })
  await page.getByText('Unmounted', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.empty = false
    window.store.connected = false
    window.mount()
  })
  await page.getByText('Upload artifact', { exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'PR build', exact: true }).count(), 1)
  assert.equal(
    await page.evaluate(
      () =>
        window.reads.filter((r) => r.path.endsWith('/pipelines/list') && r.input.refresh).length,
    ),
    0,
    'Automatic summary polling forced provider reads',
  )
  // A new attempt hides old jobs while its own sections are loading.
  await page.evaluate(() => {
    window.blocked = ['jobs']
    window.store.connected = true
    window.run.attempt = 2
    window.mount()
  })
  await page.getByText('Run 1 · Attempt 2', { exact: true }).waitFor()
  await page.getByText('Loading jobs…', { exact: true }).waitFor()
  assert.equal(await page.getByText('Compile source', { exact: true }).count(), 0)
  await page.evaluate(() => window.release('jobs'))
  const rerunJob = page.getByRole('button').filter({ hasText: 'Build job' }).last()
  await rerunJob.waitFor()
  if ((await rerunJob.getAttribute('aria-expanded')) !== 'true') await rerunJob.click()
  await page.getByText('Compile source', { exact: true }).waitFor()
  // Exercise the native hook and renderers with mocked platform primitives.
  await page.evaluate(() => {
    window.empty = true
    window.mount()
  })
  await page.getByText('Unmounted', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.empty = false
    window.mobile = true
    window.mobileOverview = { run: { ...window.run }, jobs: [] }
    window.blocked = ['graph']
    window.mount()
  })
  await page.getByRole('button', { name: 'Job Build job', exact: true }).click()
  await page.getByText('1. Compile source', { exact: true }).waitFor()
  await page.getByText('Loading workflow…', { exact: true }).waitFor()
  await page.evaluate(() => window.release('graph'))
  await page.getByRole('button', { name: 'More jobs', exact: true }).click()
  await page.getByText('1. Upload artifact', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'View job Build job', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Job Build job', exact: true }).count(),
    1,
    'Native graph selection duplicated the job',
  )
  await page.screenshot({ path: screenshots + '/mobile-dark.png', fullPage: true })
  await page.evaluate(() => window.nativeState.change('background'))
  const backgroundReads = await page.evaluate(() => window.reads.length)
  await page.clock.runFor(31000)
  assert.equal(
    await page.evaluate(() => window.reads.length),
    backgroundReads,
    'Native pipeline polled in background',
  )
  await page.evaluate(() => {
    window.empty = true
    window.mount()
  })
  await page.getByText('Unmounted', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.empty = false
    window.store.connected = false
    window.mount()
  })
  await page.getByText('1. Upload artifact', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.store.connected = true
    window.failed = ['jobs']
    window.nativeState.change('active')
    window.mount()
  })
  await page.getByText('Jobs: jobs temporarily unavailable', { exact: true }).waitFor()
  assert.equal(
    await page.getByText('1. Upload artifact', { exact: true }).count(),
    1,
    'Native refresh failure discarded cached jobs',
  )
  await page.evaluate(() => {
    window.failed = []
  })
  await page.getByRole('button', { name: 'Refresh jobs', exact: true }).click()
  await page
    .getByText('Jobs: jobs temporarily unavailable', { exact: true })
    .waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log(
    'Pipelines: independent overview/jobs/graph/options, retry, rerun isolation, pagination/offline cache, active-only desktop/native polling, retained context, graph selection and narrow layouts passed. Screenshots: /tmp/dovo-pipelines (native primitives mocked).',
  )
} finally {
  await browser.close()
}
