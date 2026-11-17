import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const controls = `export const Keyboard={dismiss(){}};export const View=({children,testID})=><div data-testid={testID}>{children}</div>;export const Text=({children})=><span>{children}</span>;export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const useTheme=()=>({styles:{muted:{},text:{},error:{}},colors:{border:'#ccc'}});`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import{createRoot}from'react-dom/client';import{useState}from'react';import{Effect}from'effect';
import{RoutineHistory as DesktopHistory,RunRoutineSource as DesktopRun,AutomaticPauseSource,useRoutineProvenance}from'./packages/extension-jobs/src/routine-provenance';
import{RoutineHistory as MobileHistory,RunRoutineSource as MobileRun}from'./apps/mobile/src/jobs/routine-provenance';
window.calls=[];window.navigations=[];window.reveals=[];window.supported=true;
window.changes=[
  {id:'c3',automationId:'flow',at:'2026-11-16T12:00:00.000Z',action:'updated',source:{kind:'person',deviceName:'Dominic iPhone'},changes:[{label:'Name',before:'Release check',after:'Weekly check'}]},
  {id:'c2',automationId:'flow',at:'2026-11-16T10:00:00.000Z',action:'updated',source:{kind:'owner',taskId:'gone',messageId:'m2',quote:'Move it to 10.',linkAvailable:false},changes:[{label:'Trigger',before:'Schedule 0 9 * * 1 · UTC',after:'Schedule 0 10 * * 1 · UTC'}]},
  {id:'c1',automationId:'flow',at:'2026-11-16T08:00:00.000Z',action:'created',source:{kind:'owner',taskId:'bot',messageId:'m1',quote:'Check releases every Monday.',truncated:true,cited:true,linkAvailable:true},changes:[{label:'Name',after:'Release check'}]},
];
const request=async(path,input)=>{window.calls.push({path,input});return{automationId:input.id,changes:window.changes}};

function Desktop({run}){const state=useRoutineProvenance('flow');return <><AutomaticPauseSource state={state} enabled={window.enabled}/><DesktopRun state={state} runCreatedAt={run}/><DesktopHistory state={state}/></>}
function App(){const[mode,setMode]=useState('desktop'),[run,setRun]=useState('2026-11-16T09:00:00.000Z'),[version,setVersion]=useState(0);
window.mode=setMode;window.run=setRun;window.reload=()=>setVersion(v=>v+1);
const flow={id:'flow',name:'Release check',enabled:window.enabled,nodes:[],edges:[]};const snapshot={routineProvenanceSupported:window.supported||undefined,routineRunProvenanceSupported:window.runSupported!==false||undefined,workspace:{automations:[flow]}};
window.store={activeRuntimeId:'profile',connected:true,connection:'a',request,snapshot,workspace:{tasks:[{id:'bot',bot:{}}]}};
window.runtime={connected:true,snapshot,profile:{id:'profile',connection:{address:'http://lan:4000',token:'t'}},callEffect:(path,input)=>Effect.tryPromise(()=>request(path,input))};
return <main key={mode+version}>{mode==='desktop'?<Desktop run={run}/>:<><MobileRun automationId="flow" runCreatedAt={run}/><MobileHistory automationId="flow"/></>}</main>};
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents:
        'export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:async target=>{window.navigations.push(target);return true}});export const formatDateTime=value=>new Date(value).toISOString();',
    },
    {
      path: '@dovo/studio-core/interface-language',
      contents:
        'export const useInterfaceText=()=>(text,values)=>values?text.replace(/\\{(\\w+)\\}/g,(m,k)=>String(values[k])):text;',
    },
    { path: '@dovo/studio-ui', contents: controls },
    { path: 'react-native', contents: controls },
    {
      path: 'expo-router',
      contents: 'export const router={push:target=>window.navigations.push(target)};',
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'jobs/',
      contents: 'export const useRuntime=()=>window.runtime;',
    },
    {
      path: '../shell/navigation',
      importer: mobile + 'jobs/',
      contents:
        'export const useNavigation=()=>({focused:true,navigate:(view,id,runtime)=>window.navigations.push({view,id,runtime})});',
    },
    { path: '../screens/settings-controls', importer: mobile + 'jobs/', contents: controls },
    {
      path: '../tasks/conversation/message-reveal',
      importer: mobile + 'jobs/',
      contents:
        'export const requestMessageReveal=(connection,taskId,messageId)=>window.reveals.push({address:connection.address,taskId,messageId});',
    },
    { path: '../ui/content/text', importer: mobile + 'jobs/', contents: controls },
    {
      path: '../ui/content/format-date',
      importer: mobile + 'jobs/',
      contents: 'export const formatDateTime=value=>new Date(value).toISOString();',
    },
    { path: '../ui/theme', importer: mobile + 'jobs/', contents: controls },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const text = (value) => page.getByText(value, { exact: true })
  for (const mode of ['desktop', 'mobile']) {
    await page.evaluate((mode) => {
      window.navigations = []
      window.reveals = []
      window.run('2026-11-16T09:00:00.000Z')
      window.mode(mode)
    }, mode)
    // The run started after creation. The agent cited the owner's words, so they are the reason.
    await text('Why this run happened').waitFor()
    await text('Because you said: "Check releases every Monday.…"').first().waitFor()
    await page.getByRole('button', { name: 'Open source message', exact: true }).first().click()
    if (mode === 'desktop')
      assert.deepEqual(await page.evaluate(() => window.navigations), [
        { viewId: 'bots', entityId: 'bot', messageId: 'm1' },
      ])
    else {
      assert.deepEqual(await page.evaluate(() => window.reveals), [
        { address: 'http://lan:4000', taskId: 'bot', messageId: 'm1' },
      ])
      assert.deepEqual(await page.evaluate(() => window.navigations), [
        { view: 'tasks', id: 'bot', runtime: 'profile' },
      ])
    }
    // A deleted source keeps its quote without a link. An uncited turn message is context only.
    await page.evaluate(() => window.run('2026-11-16T11:00:00.000Z'))
    await text('During your request: "Move it to 10."').first().waitFor()
    assert.equal(await text('Because you said: "Move it to 10."').count(), 0)
    await text('Source message unavailable').first().waitFor()
    // A run before any recorded change has no source.
    await page.evaluate(() => window.run('2026-11-16T07:00:00.000Z'))
    await text('Source not recorded').waitFor()
    if (mode === 'mobile')
      await page.getByRole('button', { name: 'Show change history (3)', exact: true }).click()
    await text('Changed by you in the editor on Dominic iPhone').waitFor()
    await text('Name: Release check → Weekly check').waitFor()
    await text('Trigger: Schedule 0 9 * * 1 · UTC → Schedule 0 10 * * 1 · UTC').waitFor()
    assert.ok(
      (await page.evaluate(() => window.calls.map((call) => call.path))).every(
        (path) => path === '/api/jobs/provenance',
      ),
    )
  }
  for (const mode of ['desktop', 'mobile']) {
    await page.evaluate((mode) => {
      window.enabled = false
      window.mode(mode)
      window.changes = [
        {
          id: 'pause',
          automationId: 'flow',
          at: '2026-11-16T12:00:00.000Z',
          action: 'updated',
          source: {
            kind: 'agent',
            taskId: 'worker',
            runId: 'run-42',
            runCreatedAt: '2026-11-16T11:30:00.000Z',
            runAvailable: true,
          },
          changes: [{ label: 'Triggers', before: 'Enabled', after: 'Paused' }],
        },
      ]
      window.navigations = []
      window.reload()
    }, mode)
    await text('Paused by an automation run').waitFor()
    await page.getByRole('button', { name: 'Open responsible run', exact: true }).first().click()
    const navigation = await page.evaluate(() => window.navigations[0])
    if (mode === 'desktop')
      assert.deepEqual(navigation, {
        viewId: 'jobs',
        entityId: 'run-42',
        automationTarget: { runtimeId: 'profile', automationId: 'flow', runId: 'run-42' },
      })
    else
      assert.deepEqual(navigation, {
        pathname: '/settings/automations/[runtimeId]/[automationId]',
        params: { runtimeId: 'profile', automationId: 'flow', runId: 'run-42' },
      })
    await page.evaluate(() => {
      window.changes[0].source.runAvailable = false
      window.reload()
    })
    await text('Responsible run unavailable').first().waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Open responsible run', exact: true }).count(),
      0,
    )
    await page.evaluate(() => {
      window.enabled = true
      window.reload()
    })
    await page.waitForFunction(
      () => !document.body.textContent.includes('Paused by an automation run'),
    )
    await page.evaluate(() => {
      window.enabled = false
      window.changes.unshift({
        id: 'later',
        automationId: 'flow',
        at: '2026-11-16T13:00:00.000Z',
        action: 'updated',
        source: { kind: 'person' },
        changes: [{ label: 'Name', after: 'New name' }],
      })
      window.reload()
    })
    await text('Changed by you in the editor').first().waitFor()
    assert.equal(await text('Paused by an automation run').count(), 0)
    await page.evaluate(() => {
      window.changes.shift()
      window.runSupported = false
      window.reload()
    })
    await text('Responsible run unavailable').first().waitFor()
    assert.equal(await text('Paused by an automation run').count(), 0)
    await page.evaluate(() => {
      window.runSupported = true
    })
  }
  // Existing routines without history, and older computers without the capability.
  await page.evaluate(() => {
    window.changes = []
    window.reload()
  })
  await text('Source not recorded').first().waitFor()
  assert.equal(await page.getByRole('button', { name: /Show change history/ }).count(), 0)
  await page.evaluate(() => {
    window.supported = false
    window.calls = []
    window.mode('desktop')
    window.reload()
  })
  await page.waitForFunction(() => !document.querySelector('main')?.textContent)
  assert.deepEqual(await page.evaluate(() => window.calls), [])
  assert.deepEqual(errors, [])
  console.log(
    'Routine provenance: web/mobile run sources, cited and turn quotes, source links, unavailable links, change history, missing sources and older runtimes pass. Native controls and transport are fixtures.',
  )
} finally {
  await browser.close()
}
