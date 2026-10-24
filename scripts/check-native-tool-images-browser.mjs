import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const react = createRequire(`${root}packages/studio-ui/package.json`)
const desktopDir = `${root}packages/extension-tasks`
const mobileDir = `${root}apps/mobile`
const controls = `
const css=style=>Object.assign({},...(Array.isArray(style)?style:[style]).flat().filter(Boolean));
export const View=({children,style})=><div style={css(style)}>{children}</div>;
export const ScrollView=View;
export const Text=({children})=><span>{children}</span>;
export const ActivityIndicator=({accessibilityLabel})=><span>{accessibilityLabel}</span>;
export const Pressable=({children,onPress,accessibilityLabel,style})=><button aria-label={accessibilityLabel} onClick={onPress} style={{display:'block',border:0,padding:0,width:'100%',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Image=({source,accessibilityLabel,onError,style})=><img src={source.uri} alt={accessibilityLabel} onError={onError} style={css(style)}/>;
export const IconButton=({label,onPress})=><button aria-label={label} onClick={onPress}>×</button>;
export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;
export const SafeModal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;
export const useAction=()=>({busy:false,error:'',act:fn=>void fn()});
export const useTheme=()=>({styles:{},colors:{muted:'#777'}});
`
const browser = await chromium.launch({ headless: true })
try {
  for (const mobile of [false, true]) {
    const stubs = mobile
      ? [
          {
            path: '../../tasks/composer/chat-image-edit-context',
            importer: `${mobileDir}/src/ui/content`,
            contents: 'export const EditChatImage=()=>null;',
          },
          ...[
            'react-native',
            '../theme',
            './text',
            '../controls/action',
            '../controls/icon-button',
            '../controls/use-action',
            '../layout/safe-modal',
          ].map((path) => ({
            path,
            ...(path.startsWith('.') ? { importer: `${mobileDir}/src/ui/content` } : {}),
            contents: controls,
          })),
          {
            path: '../../runtime/connection/provider',
            importer: `${mobileDir}/src/ui/content`,
            contents: `
import {Effect} from 'effect';
const readEffect=(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error});
export const useRuntime=()=>({connected:window.connected,connection:{address:'http://paired-runtime',token:'paired-token'},readEffect});`,
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export * from '@dovo/protocol';export const startPolling=()=>{},clientScopeKey=()=>'',formatDateTime=()=>'';export const useWorkspace=()=>({connected:window.connected,connection:{address:'http://paired-runtime',token:'paired-token'},request:window.request});export const useAppPreferences=()=>({toolActivity:'expanded',showToolDetails:false});`,
          },
          {
            path: '@dovo/studio-ui',
            contents: `export * from '${root}packages/studio-ui/src/components/ui/button';export * from '${root}packages/studio-ui/src/components/ui/dialog';export const MessageResponse=({children})=><div>{children}</div>;`,
          },
          {
            path: '@dovo/studio-core/state',
            contents: `export {useState as useApplicationState} from 'react';`,
          },
          {
            path: '../mcp-app',
            importer: `${desktopDir}/src/chat/thread`,
            contents: 'export const McpAppView=()=>null;',
          },
          {
            path: '../artifacts',
            importer: `${desktopDir}/src/chat/thread`,
            contents: 'export const ArtifactCard=()=>null;',
          },
        ]
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: mobile ? mobileDir : desktopDir,
          loader: 'tsx',
          contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {recentTools,compactActivityEvents} from '@dovo/protocol';
${mobile ? "import {ToolResultImages} from './src/tasks/conversation/components/tool-result-images';" : "import {TaskActivity} from './src/chat/thread/task-activity';"}
const item=(id,type,extra={})=>({id,scope:'thread-on-paired-computer',kind:'tool',time:'2026-10-16T20:00:00Z',summary:type==='imageView'?'View image':'Generate image',payload:JSON.stringify({toolId:id,status:'completed',event:{item:{id,type,status:'completed',...extra}}})});
const canvas=document.createElement('canvas');canvas.width=120;canvas.height=60;canvas.getContext('2d').fillRect(0,0,120,60);window.png=canvas.toDataURL('image/png');
const tools=recentTools(compactActivityEvents([item('generated','imageGeneration',{result:window.png.split(',')[1]}),item('viewed','imageView',{path:'/runtime-only/view.png'}),item('saved','imageGeneration',{result:'',savedPath:'/runtime-only/generated.png'})]));
window.requests=[];window.connected=true;window.fail=true;
window.request=async(path,input)=>{window.requests.push({path,input});if(window.fail&&input.eventId==='viewed')throw Error('Image temporarily unavailable');return {uri:window.png}};
function App(){const[folded,setFolded]=useState(false),[revision,setRevision]=useState(0);window.fold=()=>setFolded(true);window.refresh=()=>setRevision(v=>v+1);return <div data-revision={revision}>${mobile ? '{tools.map(event=><ToolResultImages key={event.id} event={event}/>)}' : '<TaskActivity tools={tools} artifactsOnly={folded}/>'}</div>}
createRoot(document.getElementById('app')).render(<App/>);`,
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        conditions: ['development'],
        loader: { '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"production"' },
        alias: {
          '@dovo/protocol': `${root}packages/protocol/src/index.ts`,
          react: react.resolve('react'),
          'react-dom': `${root}packages/studio-ui/node_modules/react-dom`,
          'react/jsx-runtime': react.resolve('react/jsx-runtime'),
        },
      },
      stubs,
    )
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1000, height: 800 },
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByText('Image temporarily unavailable', { exact: false }).waitFor()
    await page.evaluate(() => (window.fail = false))
    await page.getByRole('button', { name: /^Retry / }).click()
    await page.waitForFunction(
      () =>
        document.querySelectorAll('img').length === 3 &&
        [...document.querySelectorAll('img')].every(
          (img) => img.complete && img.naturalWidth === 120,
        ),
    )
    if (mobile) {
      for (const image of await page.locator('img').all()) {
        const bounds = await image.boundingBox()
        assert.equal(bounds.height, 96, 'Tool images stay compact in the conversation')
        assert.equal(bounds.width, 128)
      }
    }
    const viewedLabel = 'View view.png image 1'
    await page
      .getByRole('button', { name: `${mobile ? 'Open' : 'Preview'} ${viewedLabel}`, exact: true })
      .click()
    await page.getByRole('dialog').waitFor()
    await page.waitForFunction(() =>
      window.requests.some((r) => r.input.eventId === 'viewed' && r.input.maxSize === 2048),
    )
    if (mobile) await page.getByRole('button', { name: 'Close image' }).click()
    else await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    if (!mobile) {
      await page.evaluate(() => window.fold())
      await page.waitForFunction(() => document.querySelectorAll('img').length === 3)
      await page.getByRole('region', { name: 'Task tool activity' }).waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.querySelectorAll('img').length === 3)
    }
    assert.equal(await page.locator('img').count(), 3)
    const requests = await page.evaluate(() => window.requests)
    assert.ok(requests.length >= 4)
    for (const { path, input } of requests) {
      assert.equal(path, '/api/tasks/images/read')
      assert.equal(input.taskId, 'thread-on-paired-computer')
      assert.ok(['generated', 'viewed', 'saved'].includes(input.eventId))
      assert.equal(input.index, 0)
      assert.equal(input.path, undefined)
    }
    await page.evaluate(() => {
      window.connected = false
      window.refresh()
    })
    await page
      .getByText(/Reconnect to (?:load|the image)/)
      .first()
      .waitFor()
    await page.evaluate(() => {
      window.connected = true
      window.refresh()
    })
    await page.waitForFunction(() => document.querySelectorAll('img').length === 3)
    assert.deepEqual(errors, [])
    console.log(
      `${mobile ? 'Mobile (browser adapters)' : 'Desktop'}: native generated/viewed/saved images, retry, large preview, pairing-aware requests and reconnect passed.`,
    )
    await page.close()
  }
} finally {
  await browser.close()
}
