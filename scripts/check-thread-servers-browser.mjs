import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const browser = await chromium.launch()
try {
  for (const platform of ['desktop', 'mobile']) {
    const directory =
      platform === 'desktop'
        ? root + 'packages/extension-tasks/src/detail'
        : root + 'apps/mobile/src/tasks/detail'
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Effect} from 'effect';import {decode} from '@dovo/protocol';import {ThreadServers} from '${directory}/thread-servers.tsx';
window.calls=[];window.opened=[];window.releases=[];window.visible=true;
Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.visible?'visible':'hidden'});
window.show=visible=>{window.visible=visible;document.dispatchEvent(new Event('visibilitychange'))};
const server=(port,pid)=>({port,pid,started:'start-'+pid,name:'node',source:pid%2?'agent':'terminal',url:'http://127.0.0.1:'+port});
window.serverData={'alpha:one':[server(3000,101),server(3001,102),{...server(3002,103),url:undefined}],'alpha:two':[server(4000,201)],'beta:one':[server(5000,301)],'beta:two':[server(6000,401)]};
const request=owner=>async(path,input,schema)=>{
 window.calls.push({owner,path,input});
 if(path.endsWith('/stop')){
  if(window.holdStop){window.holdStop=false;await new Promise(resolve=>window.releaseStop=resolve)}
  if(window.stopFail){window.stopFail=false;throw Error('Server ownership changed')}
  window.serverData[owner+':'+input.taskId]=window.serverData[owner+':'+input.taskId].filter(server=>server.pid!==input.pid);
  return decode(schema,{ok:true});
 }
 const servers=window.serverData[owner+':'+input.taskId].map(server=>({...server}));
 if(window.holdNextRead){window.holdNextRead=false;await new Promise(resolve=>window.releases.push(resolve))}
 if(window.readFail){window.readFail=false;throw Error('Server list unavailable')}
 return decode(schema,{servers,supported:true});
};
const connections=Object.fromEntries(['alpha','beta'].map(owner=>{const run=request(owner);const effect=(path,input,schema)=>Effect.tryPromise({try:()=>run(path,input,schema),catch:error=>error});return [owner,{request:run,connection:{address:'http://'+owner+'.local:8787',token:'paired-'+owner},profile:{id:owner,connection:{address:'http://'+owner+'.local:8787',token:'paired-'+owner}},readEffect:effect,callEffect:effect}]}));
function App(){const[config,setConfig]=useState({owner:'alpha',taskId:'one',connected:true,foreground:true,mounted:true,supported:true,revision:0});
 window.patch=value=>flushSync(()=>setConfig(previous=>({...previous,...value})));window.context={...connections[config.owner],connected:config.connected,snapshot:{threadServersSupported:config.supported}};window.foreground=config.foreground;
 return <main>{config.mounted&&<ThreadServers taskId={config.taskId} onOpen={url=>window.opened.push({owner:config.owner,taskId:config.taskId,url})}/>}</main>;
}createRoot(document.getElementById('app')).render(<App/>);`,
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
        nodePaths: [root + 'node_modules'],
      },
      platform === 'desktop'
        ? [
            {
              path: '@dovo/studio-core',
              contents: 'export const useWorkspace=()=>window.context;',
            },
            {
              path: '@dovo/studio-ui',
              contents: `export const Button=({children,onClick,disabled,title})=><button title={title} onClick={onClick} disabled={disabled}>{children}</button>;export const IconButton=({children,label,onClick,disabled})=><button aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;`,
            },
          ]
        : [
            {
              path: '../../runtime/connection/provider',
              importer: directory,
              contents: 'export const useRuntime=()=>window.context;',
            },
            {
              path: '../../runtime/state/app-active',
              importer: directory,
              contents: 'export const useAppActive=()=>window.foreground;',
            },
            {
              path: 'react-native',
              contents:
                'export const View=({children,accessibilityLabel})=><section aria-label={accessibilityLabel}>{children}</section>;',
            },
            {
              path: '../../ui/content/text',
              importer: directory,
              contents: 'export const Text=({children})=><p>{children}</p>;',
            },
            {
              path: '../../ui/controls/action',
              importer: directory,
              contents:
                'export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;',
            },
            {
              path: '../../ui/theme',
              importer: directory,
              contents: 'export const useTheme=()=>({styles:{muted:{},error:{}}});',
            },
          ],
    )
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.install()
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const panel = page.getByRole('region', { name: 'Running servers' })
    const open = (port) =>
      page.getByRole('button', {
        name: new RegExp(
          `^(?:Open )?localhost:${port}(?:\\s*(?:Agent|Terminal)(?:\\s*·\\s*TCP)?)?$`,
        ),
      })
    const stop = (port) => page.getByRole('button', { name: `Stop localhost:${port}`, exact: true })
    const count = () => page.evaluate(() => window.calls.length)
    const pause = async () => {
      if (platform === 'desktop') await page.evaluate(() => window.show(false))
      else await page.evaluate(() => window.patch({ foreground: false }))
    }
    const resume = async () => {
      if (platform === 'desktop') await page.evaluate(() => window.show(true))
      else await page.evaluate(() => window.patch({ foreground: true }))
    }
    await open(3000).waitFor()
    assert.equal(
      await open(3002).isDisabled(),
      true,
      'Raw TCP listeners must not open as web pages',
    )
    assert.equal(await stop(3002).isEnabled(), true)
    await open(3000).click()
    assert.deepEqual(await page.evaluate(() => window.opened), [
      { owner: 'alpha', taskId: 'one', url: 'http://127.0.0.1:3000' },
    ])
    await page.evaluate(() => window.patch({ revision: 1 }))
    assert.equal(await count(), 1, 'Presentation-only rerenders must not restart server polling')
    await stop(3000).click()
    await stop(3000).waitFor({ state: 'detached' })
    const firstStop = await page.evaluate(() =>
      window.calls.find((call) => call.path.endsWith('/stop')),
    )
    assert.deepEqual(firstStop, {
      owner: 'alpha',
      path: '/api/terminals/servers/stop',
      input: { taskId: 'one', pid: 101, port: 3000, started: 'start-101' },
    })
    assert.equal(await open(3001).count(), 1)
    // Errors preserve the remaining server and allow an immediate retry.
    await page.evaluate(() => (window.stopFail = true))
    await stop(3001).click()
    await page.getByText(/Server ownership changed/).waitFor()
    const retry = page.getByRole('button', {
      name: platform === 'desktop' ? 'Retry' : 'Retry servers',
      exact: true,
    })
    await retry.click()
    await open(3001).waitFor()
    assert.equal(await page.getByText(/Server ownership changed/).count(), 0)

    // A late read from another task/computer must never replace the active list.
    await page.evaluate(() => {
      window.holdNextRead = true
      window.patch({ taskId: 'two' })
    })
    await page.waitForFunction(() => window.releases.length === 1)
    await page.evaluate(() => window.patch({ owner: 'beta', taskId: 'one' }))
    await open(5000).waitFor()
    await page.evaluate(() => window.releases.shift()())
    await open(5000).waitFor()
    assert.equal(await open(4000).count(), 0)
    await open(5000).click()
    assert.deepEqual(await page.evaluate(() => window.opened.at(-1)), {
      owner: 'beta',
      taskId: 'one',
      url: 'http://127.0.0.1:5000',
    })
    // Failed list reads have an explicit error and retry without a clock advance.
    await page.evaluate(() => {
      window.readFail = true
      window.patch({ taskId: 'two' })
    })
    await page.getByText(/Server list unavailable/).waitFor()
    await retry.click()
    await open(6000).waitFor()

    // Foreground, connection and mount state own the poll timer.
    await page.clock.runFor(5100)
    await pause()
    const hiddenReads = await count()
    await page.clock.runFor(16000)
    assert.equal(await count(), hiddenReads, `${platform} continued polling in the background`)
    await resume()
    await open(6000).waitFor()
    assert.ok((await count()) > hiddenReads, 'Returning to the foreground must refresh immediately')
    await page.evaluate(() => window.patch({ connected: false }))
    const offlineReads = await count()
    await page.clock.runFor(16000)
    assert.equal(await count(), offlineReads, 'Disconnected panels must not poll')
    await page.evaluate(() => window.patch({ connected: true }))
    await open(6000).waitFor()
    await page.evaluate(() => window.patch({ mounted: false }))
    const unmountedReads = await count()
    await page.clock.runFor(16000)
    assert.equal(await count(), unmountedReads, 'Unmounted panels must release polling')
    assert.equal(await panel.count(), 0)

    // Older/unsupported runtimes must never receive unknown discovery endpoints.
    await page.evaluate(() => window.patch({ mounted: true, supported: false }))
    const unsupportedReads = await count()
    await page.clock.runFor(16000)
    assert.equal(await count(), unsupportedReads)
    assert.equal(await panel.count(), 0)
    await page.evaluate(() => window.patch({ supported: true }))
    await open(6000).waitFor()

    // Stopping remains bound to the original owner even if the active computer changes.
    await page.evaluate(() => window.patch({ mounted: true, taskId: 'one', owner: 'alpha' }))
    await open(3001).waitFor()
    await page.evaluate(() => (window.holdStop = true))
    await stop(3001).click()
    await page.waitForFunction(() => !!window.releaseStop)
    await page.evaluate(() => window.patch({ owner: 'beta' }))
    await open(5000).waitFor()
    await page.evaluate(() => window.releaseStop())
    await open(5000).waitFor()
    assert.equal(await open(3001).count(), 0)
    assert.equal(await stop(5000).isEnabled(), true)

    // A poll that began before Stop must not resurrect the stopped row.
    await page.evaluate(() => (window.holdNextRead = true))
    await page.clock.runFor(5100)
    await page.waitForFunction(() => window.releases.length === 1)
    await stop(5000).click()
    if (platform === 'desktop') await stop(5000).waitFor({ state: 'detached' })
    await page.evaluate(() => window.releases.shift()())
    await stop(5000).waitFor({ state: 'detached' })
    assert.equal(await open(5000).count(), 0, 'A stale pre-stop list resurrected a stopped server')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${platform} thread servers: owner-bound open/stop, process identity, refresh/retry, stale replies, stop/poll ordering and foreground/disconnect/unmount polling passed.`,
    )
  }
  await verifyMobileBrowserHandoff(browser)
} finally {
  await browser.close()
}

async function verifyMobileBrowserHandoff(browser) {
  const directory = root + 'apps/mobile/src/tasks/preview'
  const native = `export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Image=()=>null;export const Platform={OS:'ios'};export const Keyboard={isVisible:()=>false,addListener:()=>({remove(){}})};export const StyleSheet={hairlineWidth:1};`
  const built = await bundleBrowser(
    {
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {useCallback,useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {BrowserPane} from '${directory}/browser-pane.tsx';
window.previewMounts=[];window.acks=0;
function App(){const[config,setConfig]=useState({owner:'alpha',taskId:'one',mounted:true,link:{id:'first',url:'http://127.0.0.1:3000'},revision:0});window.browserPatch=value=>flushSync(()=>setConfig(previous=>({...previous,...value})));const consumed=useCallback(()=>{window.acks++;setConfig(previous=>({...previous,link:undefined}))},[]);window.context={profile:{id:config.owner,connection:{address:'http://'+config.owner+'.local:8787'}},snapshot:{workspace:{tasks:[]}}};return config.mounted?<BrowserPane taskId={config.taskId} expanded={false} onExpand={()=>{}} openLink={config.link} onLinkOpened={consumed}/>:null}createRoot(document.getElementById('app')).render(<App/>);
`,
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
      nodePaths: [root + 'node_modules'],
    },
    [
      { path: 'expo-router', contents: 'export const router={push(){}};' },
      { path: 'react-native-view-shot', contents: 'export const captureRef=async()=>"";' },
      { path: 'react-native', contents: native },
      {
        path: 'react-native-screens/experimental',
        contents: 'export const SafeAreaView=({children})=><div>{children}</div>;',
      },
      { path: 'react-native-webview', contents: 'export const WebView=()=>null;' },
      {
        path: '../../ui/content/open-link',
        importer: directory,
        contents: 'export const useOpenAppLink=()=>()=>{};',
      },
      {
        path: '../../runtime/state/application-state',
        importer: directory,
        contents: "export {useState as useApplicationState} from 'react';",
      },
      {
        path: '../../runtime/connection/provider',
        importer: directory,
        contents: 'export const useRuntime=()=>window.context;',
      },
      {
        path: '../../ui/content/text',
        importer: directory,
        contents: 'export const Text=({children})=><p>{children}</p>;',
      },
      {
        path: '../../ui/controls/field',
        importer: directory,
        contents: 'export const Field=()=>null;',
      },
      {
        path: '../../ui/controls/action',
        importer: directory,
        contents: 'export const Action=()=>null;',
      },
      {
        path: '../../ui/controls/icon-button',
        importer: directory,
        contents: 'export const IconButton=()=>null;',
      },
      {
        path: '../../ui/controls/use-action',
        importer: directory,
        contents: 'export const useAction=()=>({act(){},error:"",busy:false});',
      },
      {
        path: '../../ui/theme',
        importer: directory,
        contents: 'export const useTheme=()=>({colors:{},styles:{}});',
      },
      {
        path: './screenshot-attachment',
        importer: directory,
        contents: 'export const useScreenshotAttachment=()=>({});',
      },
      {
        path: './remote-browser',
        importer: directory,
        contents: `import {useEffect,useState} from 'react';export const RemoteBrowser=({taskId,initialUrl})=>{const[url,setUrl]=useState(initialUrl??'(resume)');window.previewNavigate=setUrl;useEffect(()=>{window.previewMounts.push({owner:window.context.profile.id,taskId,url:initialUrl??null})},[]);return <p aria-label="Remote preview">{url}</p>};`,
      },
      {
        path: './browser-toolbar',
        importer: directory,
        contents: 'export const BrowserToolbar=()=>null;',
      },
      {
        path: './physical-controls',
        importer: directory,
        contents: 'export const PhysicalControls=()=>null;',
      },
      {
        path: './device-actions',
        importer: directory,
        contents: 'export const DeviceActions=()=>null;',
      },
      {
        path: '../../screens/device-host-form',
        importer: directory,
        contents: 'export const deviceHostMessage=()=>"";',
      },
      {
        path: './use-preview-active',
        importer: directory,
        contents: 'export const usePreviewActive=()=>true;',
      },
    ],
  )
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const preview = page.getByLabel('Remote preview', { exact: true })
  await preview.getByText('http://127.0.0.1:3000', { exact: true }).waitFor()
  await page.waitForFunction(() => window.acks === 1)
  assert.deepEqual(await page.evaluate(() => window.previewMounts), [
    { owner: 'alpha', taskId: 'one', url: 'http://127.0.0.1:3000' },
  ])
  await page.evaluate(() => {
    window.previewNavigate('http://127.0.0.1:3000/current')
    window.browserPatch({ revision: 1 })
  })
  await preview.getByText('http://127.0.0.1:3000/current', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => window.previewMounts.length),
    1,
    'Acknowledging a handoff must preserve the active browser instance',
  )
  await page.evaluate(() => window.browserPatch({ mounted: false }))
  await page.evaluate(() => window.browserPatch({ mounted: true }))
  await preview.getByText('(resume)', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.previewMounts.at(-1)), {
    owner: 'alpha',
    taskId: 'one',
    url: null,
  })
  await page.evaluate(() =>
    window.browserPatch({ link: { id: 'second', url: 'http://127.0.0.1:4000' } }),
  )
  await preview.getByText('http://127.0.0.1:4000', { exact: true }).waitFor()
  await page.waitForFunction(() => window.acks === 2)
  await page.evaluate(() => window.browserPatch({ taskId: 'two' }))
  await preview.getByText('(resume)', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.previewMounts.at(-1)), {
    owner: 'alpha',
    taskId: 'two',
    url: null,
  })
  await page.evaluate(() =>
    window.browserPatch({ link: { id: 'third', url: 'http://127.0.0.1:5000' } }),
  )
  await preview.getByText('http://127.0.0.1:5000', { exact: true }).waitFor()
  await page.waitForFunction(() => window.acks === 3)
  await page.evaluate(() => window.browserPatch({ owner: 'beta' }))
  await preview.getByText('(resume)', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.previewMounts.at(-1)), {
    owner: 'beta',
    taskId: 'two',
    url: null,
  })
  assert.deepEqual(errors, [])
  await page.close()
  console.log(
    'Mobile browser handoffs: consumed links preserve the live preview, never replay after remount, and cannot cross threads or computers.',
  )
}
