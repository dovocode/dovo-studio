import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {RemoteBrowser} from './src/browser/remote-browser.tsx';
window.host={sessions:new Map(),calls:[],states:[]};
function App(){
  const [url,setUrl]=useState('http://localhost:3000/initial');
  const [mount,setMount]=useState(0);
  window.setInitialUrl=setUrl;
  window.remount=()=>setMount(value=>value+1);
  return <><span data-url={url}/><RemoteBrowser key={mount} taskId="task" tabId="tab"
    initialUrl={url} onState={state=>{
      window.host.states.push(state.url);
      setUrl(state.url==='about:blank'?'':state.url);
    }}/></>;
}
window.bridge=(data)=>window.dispatchEvent(new MessageEvent('message',{
  source:document.querySelector('iframe').contentWindow,
  data:{channel:'dovo-browser',...data},
}));
window.recover=(url)=>{
  window.bridge({type:'state',url,title:'Current page',editable:false,back:false,forward:false,loading:false});
  // The host has expired the old session or restarted. Its next open uses the supplied URL.
  window.host.sessions.clear();
  // Reconnect immediately, before React can commit the parent's updated tab URL.
  window.bridge({type:'reconnect'});
};
createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: root + 'packages/extension-tasks',
    loader: 'tsx',
  },
  alias: { '@dovo/protocol': root + 'packages/protocol/src/index.ts' },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  plugins: [
    {
      name: 'host-boundary',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/studio-core$/ }, () => ({
          path: 'core',
          namespace: 'host',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({
          resolveDir: root + 'packages/extension-tasks',
          contents: `
export {remoteBrowserTicketSchema,responses} from '@dovo/protocol';
import {decode,remoteBrowserOpenSchema} from '@dovo/protocol';
const request=async(path,input)=>{
  const body=decode(remoteBrowserOpenSchema,input);
  if(path!=='/api/previews/browser/open')throw new Error('Unexpected request: '+path);
  const url=window.host.sessions.get(body.tabId)??(body.url||'about:blank');
  window.host.sessions.set(body.tabId,url);
  window.host.calls.push({body,url});
  return {ticket:'one-use-ticket',tabId:body.tabId,profileId:body.profileId};
};
const connection={address:'http://runtime.lan:4310',token:'device-token'};
export const useWorkspace=()=>({connection,request});
export const remoteBrowserHtml='<html><body>Host viewer bridge</body></html>';
export const readAppPreferences=()=>({browserViewport:'fill'});
`,
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const opened = async (count, expected) => {
    await page.waitForFunction((count) => window.host.calls.length === count, count)
    const latest = await page.evaluate(() => window.host.calls.at(-1))
    assert.equal(latest.body.url, expected)
    assert.equal(latest.url, expected || 'about:blank')
  }
  await opened(1, 'http://localhost:3000/initial')
  await page.evaluate(() => window.recover('http://localhost:3000/current'))
  await opened(2, 'http://localhost:3000/current')
  assert.equal(
    await page.evaluate(() => window.host.states.at(-1)),
    'http://localhost:3000/current',
  )

  // A remounted iframe (for example after switching profiles) retains the current tab URL.
  await page.evaluate(() => {
    window.host.sessions.clear()
    window.remount()
  })
  await opened(3, 'http://localhost:3000/current')

  await page.evaluate(() => window.recover('about:blank'))
  await opened(4, '')
  await page.evaluate(() => {
    window.host.sessions.clear()
    window.remount()
  })
  await opened(5, '')

  // A deliberate URL prop update also changes recovery without remounting the component.
  await page.evaluate(() => window.setInitialUrl('http://localhost:3000/selected'))
  await page.waitForFunction(
    () => document.querySelector('[data-url]').dataset.url === 'http://localhost:3000/selected',
  )
  await page.evaluate(() => {
    window.host.sessions.clear()
    window.bridge({ type: 'reconnect' })
  })
  await opened(6, 'http://localhost:3000/selected')
  assert.deepEqual(errors, [])
  console.log(
    'Production RemoteBrowser: latest-page recovery, remount, blank pages and URL prop updates passed.',
  )
} finally {
  await browser.close()
}
