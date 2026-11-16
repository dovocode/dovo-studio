import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const renderer = JSON.parse(
  await readFile('packages/runtime/src/mcp-apps/a2ui-renderer.json', 'utf8'),
)
const example = JSON.parse(await readFile('examples/a2ui/issue-picker.json', 'utf8'))
const surface = example.messages[0].createSurface
surface.components.find((component) => component.id === 'root').children.splice(1, 0, 'details')
surface.components.push(
  { id: 'details', component: 'Disclosure', title: 'All evidence', child: 'evidence', open: true },
  { id: 'evidence', component: 'Column', children: Array.from({ length: 50 }, (_, i) => `e${i}`) },
  ...Array.from({ length: 50 }, (_, i) => ({
    id: `e${i}`,
    component: 'Text',
    text: `Evidence ${i + 1}. A long workspace must expand within the conversation without a second vertical scroll area.`,
  })),
)
const app = {
  id: 'inline-app',
  taskId: 'thread',
  title: 'Inline workspace',
  server: 'dovo_task',
  tool: 'a2ui',
  input: {},
  format: 'apps',
  connected: true,
  result: {
    content: [],
    structuredContent: {
      revision: 1,
      draftVersion: 0,
      messages: example.messages,
      values: {},
      submitted: false,
    },
  },
  resource: {
    uri: 'ui://dovo/a2ui/v1',
    mimeType: 'text/html;profile=mcp-app',
    text: renderer,
    _meta: { ui: { csp: {} } },
  },
}
async function bundleClient(native) {
  return await bundleBrowser(
    {
      stdin: {
        resolveDir: root + 'packages/studio-ui',
        loader: 'tsx',
        contents: `
import {createRoot} from 'react-dom/client';
import {McpAppView} from '${native ? '../../apps/mobile/src/ui/content/mcp-app' : '../extension-tasks/src/chat/mcp-app'}';
window.fixtureApp=${JSON.stringify(app)};
window.fixtureRequest=async(path,input)=>{
  if(path==='/api/mcp-apps/read')return {app:window.fixtureApp};
  if(input.method==='tools/list')return {result:{tools:[]}};
  if(input.method==='ui/update-model-context')return {result:{}};
  if(input.method==='tools/call')return {result:window.fixtureApp.result};
  throw Error('Unexpected fixture request '+JSON.stringify(input));
};
createRoot(document.getElementById('app')).render(<McpAppView visible reference={{id:'inline-app',taskId:'thread',title:'Inline workspace'}}/>);`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    },
    native
      ? [
          {
            path: '@dovo/studio-core/interface-language',
            contents: `export const useInterfaceText=()=>text=>text;export const InterfaceText=({children})=>children;`,
          },
          {
            path: 'react-native',
            contents: `export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',...style}}>{children}</div>;export const Alert={alert(){throw Error('Unexpected native approval')}};`,
          },
          { path: 'expo-crypto', contents: `export {randomUUID} from '@dovo/protocol';` },
          { path: 'expo-file-system', contents: `export class File{};export const Paths={};` },
          {
            path: 'expo-sharing',
            contents: `export const isAvailableAsync=async()=>false;export const shareAsync=async()=>{};`,
          },
          {
            path: '../layout/safe-modal',
            importer: root + 'apps/mobile/src/ui/content/',
            contents: `export const SafeModal=({children})=><div>{children}</div>;`,
          },
          {
            path: '../controls/action',
            importer: root + 'apps/mobile/src/ui/content/',
            contents: `export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;`,
          },
          {
            path: './text',
            importer: root + 'apps/mobile/src/ui/content/',
            contents: `export const Text=({children,style})=><span style={Array.isArray(style)?Object.assign({},...style):style}>{children}</span>;`,
          },
          {
            path: './open-link',
            importer: root + 'apps/mobile/src/ui/content/',
            contents: `export const useOpenAppLink=()=>()=>{};`,
          },
          {
            path: '../theme',
            importer: root + 'apps/mobile/src/ui/content/',
            contents: `import {useState} from 'react';export const useTheme=()=>{const [mode,setMode]=useState('dark');window.setFixtureTheme=setMode;return {mode,colors:{border:'#444',background:'#191b20'},styles:{}}};`,
          },
          {
            path: '../../runtime/connection/provider',
            importer: root + 'apps/mobile/src/ui/content/',
            contents: `const request=(...args)=>window.fixtureRequest(...args);export const useRuntime=()=>({call:request,read:request,connected:true,activeId:'local',connection:undefined});`,
          },
          {
            path: '@dovo/client-runtime',
            contents: `export const startMcpAppTools=()=>({setTools(){},setVisible(){},stop:async()=>{}});`,
          },
          {
            path: 'react-native-webview',
            contents: `import {forwardRef,useRef,useImperativeHandle,useEffect} from 'react';
export default forwardRef(function WebView({source,style,onLoad,onMessage,scrollEnabled},ref){
  const frame=useRef();const receive=useRef(onMessage);receive.current=onMessage;
  useImperativeHandle(ref,()=>({injectJavaScript:script=>frame.current.contentWindow.eval(script),reload:()=>frame.current.contentWindow.location.reload()}),[]);
  useEffect(()=>{const listener=event=>{if(event.source===frame.current?.contentWindow&&typeof event.data?.nativeText==='string')receive.current({nativeEvent:{data:event.data.nativeText}})};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener)},[]);
  const html=source.html.replace('<script>','<script>window.ReactNativeWebView={postMessage:text=>parent.postMessage({nativeText:text},"*")};');
  return <iframe ref={frame} srcDoc={html} style={style} data-scroll-enabled={String(scrollEnabled)} onLoad={onLoad}/>;
});`,
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `
import {useState} from 'react';
const workspace={tasks:[]};
export const useWorkspace=()=>({request:window.fixtureRequest,connected:true,activeRuntimeId:'local',connection:undefined,workspace});
export const useResolvedTheme=()=>{const [theme,setTheme]=useState('dark');window.setFixtureTheme=setTheme;return theme};
export const useStudioHost=()=>({});
export const clientScopeKey=()=> 'fixture';
export const useConfirmation=()=>async()=>true;
export const startMcpAppTools=()=>({setTools(){},setVisible(){},stop:async()=>{}});`,
          },
        ],
  )
}

const browser = await chromium.launch({ headless: true })
try {
  for (const [native, width] of [
    [false, 1000],
    [false, 390],
    [true, 390],
  ]) {
    const built = await bundleClient(native)
    const page = await browser.newPage({ viewport: { width, height: 850 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      `<style>body{margin:0;background:#191b20;color:#eceef3;font:14px system-ui}#conversation{height:800px;overflow:auto}iframe{width:100%;border:0;display:block}</style><div id="conversation"><p>Earlier message</p><div id="app"></div><p id="after">Next message</p></div>`,
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const ui = page.frameLocator('iframe').frameLocator('iframe').frameLocator('iframe')
    await ui
      .getByRole('heading', { name: 'Choose the next work' })
      .waitFor({ timeout: 10000 })
      .catch(async (error) => {
        console.error({
          native,
          width,
          errors,
          frames: await Promise.all(
            page.frames().map((frame) => frame.locator('body').innerText()),
          ),
        })
        throw error
      })
    const guest = page.frames().at(-1)
    await guest.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    if (native)
      assert.equal(await page.locator('iframe').getAttribute('data-scroll-enabled'), 'false')
    assert.equal(await page.getByRole('button', { name: 'Expand', exact: true }).count(), 0)
    const contentHeight = await ui
      .locator('main')
      .evaluate((element) => element.getBoundingClientRect().height)
    assert.ok(contentHeight > 1500, `Fixture must exceed the old height cap: ${contentHeight}`)
    await page
      .waitForFunction(
        (height) => document.querySelector('iframe').clientHeight >= height - 1,
        contentHeight,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        console.error(
          'Frame sizes',
          await Promise.all(
            page.frames().map((frame) =>
              frame.evaluate(() => ({
                height: innerHeight,
                scroll: document.documentElement.scrollHeight,
                body: document.body.getBoundingClientRect().height,
                root: document.querySelector('#root')?.getBoundingClientRect().height,
              })),
            ),
          ),
        )
        throw error
      })
    for (const frame of page.frames().slice(1))
      assert.equal(
        await frame.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight + 1 && scrollY === 0,
        ),
        true,
        'Only the conversation scrolls vertically',
      )
    assert.equal(
      await guest.evaluate(() => getComputedStyle(document.body).backgroundColor),
      'rgba(0, 0, 0, 0)',
      'Workspace background follows the conversation',
    )
    await ui.getByText('All evidence', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('iframe').clientHeight < 1200)
    await ui.getByLabel('Instructions').fill('Keep this draft when the theme changes')
    await ui.getByRole('status').filter({ hasText: 'Draft saved' }).waitFor()
    await page.evaluate(() => window.setFixtureTheme('light'))
    await guest.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    assert.equal(
      await ui.getByLabel('Instructions').inputValue(),
      'Keep this draft when the theme changes',
    )
    await page.evaluate(() => window.setFixtureTheme('dark'))
    await guest.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await ui.getByText('All evidence', { exact: true }).click()
    await page.waitForFunction(
      (height) => document.querySelector('iframe').clientHeight >= height - 1,
      contentHeight,
    )
    await ui.getByRole('button', { name: 'Send selection' }).scrollIntoViewIfNeeded()
    assert.ok((await page.locator('#conversation').evaluate((element) => element.scrollTop)) > 0)
    for (const frame of page.frames().slice(1)) assert.equal(await frame.evaluate(() => scrollY), 0)
    await mkdir('work/a2ui-inline', { recursive: true })
    await page.screenshot({ path: `work/a2ui-inline/${native ? 'native-' : ''}${width}.png` })
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'A2UI inline checks passed: actual desktop and mobile clients with browser/native WebView fixture, full height, shrink/grow, transparent background, theme changes and draft preservation.',
  )
} finally {
  await browser.close()
}
