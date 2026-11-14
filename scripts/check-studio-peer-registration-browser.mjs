import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {Effect} from 'effect';
import {StudioPairedComputersBridge} from './packages/studio-shell/src/studio-paired-computers-bridge';
import {useStudioPairedComputers} from './apps/mobile/src/runtime/connection/studio-paired-computers';
const profile=(id,address)=>({id,name:id,connection:{address,token:'private-paired-token-'+id,runtimeId:id}});
const source=profile('source','http://100.64.0.10:51464'), bot=profile('bot','http://100.64.0.20:51464');
const overview=profile=>({profile,connected:true,snapshot:{runtimeId:profile.id,studioTools:{threads:true},studioPeerRegistrationEnabled:true}});
window.calls=[];
window.fetch=async (url,options)=>{window.calls.push({url,input:JSON.parse(options.body)});return {ok:true}};
window.studio={connection:source.connection,connected:true,snapshot:overview(source).snapshot,runtimeRegistry:{version:1,activeId:source.id,profiles:[source,bot]},runtimes:[overview(source)]};
const read=(owner,path,input)=>Effect.sync(()=>{window.calls.push({mobile:true,url:owner.connection.address+path,input});return {ok:true}});
function App(){const [revision,setRevision]=useState(0);const [active,setActive]=useState(true);window.refresh=()=>setRevision(value=>value+1);window.active=setActive;
useStudioPairedComputers(window.studio.runtimes,window.studio.runtimeRegistry,active,read);
return <StudioPairedComputersBridge/>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      react: root + 'packages/studio-ui/node_modules/react',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [{ path: '@dovo/studio-core', contents: 'export const useWorkspace=()=>window.studio;' }],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const calls = () => page.evaluate(() => window.calls)
  const waitCalls = (count) => page.waitForFunction((count) => window.calls.length >= count, count)
  await waitCalls(3)
  let sent = await calls()
  assert.equal(sent.filter((call) => call.url.endsWith('/api/studio/peers')).length, 2)
  for (const call of sent)
    assert.deepEqual(
      call.input.peers.map((peer) => peer.connection.runtimeId),
      ['bot'],
    )
  // Thread updates keep the same registration fingerprint and do not create network traffic.
  await page.evaluate(() => {
    window.calls = []
    window.studio.runtimes[0].snapshot.workspace = { tasks: [{ title: 'streamed update' }] }
    window.refresh()
  })
  await page.waitForTimeout(100)
  assert.deepEqual(await calls(), [])
  // Mobile has no background publication. Desktop registers only on its own dependency change.
  await page.evaluate(() => window.active(false))
  await page.evaluate(() => {
    window.calls = []
    window.studio.runtimeRegistry.profiles[1].name = 'Renamed Bot'
    window.refresh()
  })
  await waitCalls(2)
  assert.equal((await calls()).filter((call) => call.mobile).length, 0)
  await page.evaluate(() => {
    window.calls = []
    window.active(true)
  })
  await waitCalls(1)
  assert.equal((await calls()).filter((call) => call.mobile).length, 1)
  // A pending pairing never becomes a credential source.
  await page.evaluate(() => {
    window.calls = []
    window.studio.runtimeRegistry.pendingPairings = [
      { profile: window.studio.runtimeRegistry.profiles[1] },
    ]
    window.refresh()
  })
  await waitCalls(3)
  for (const call of await calls()) assert.deepEqual(call.input.peers, [])
  // Disabled/older remote runtimes receive retrieval credentials only. An unrelated active
  // runtime's enabled setting must not grant access on their behalf.
  await page.evaluate(() => {
    window.calls = []
    window.studio.runtimes[0].snapshot = {
      runtimeId: 'source',
      studioTools: { threads: true },
      studioPeerRegistrationEnabled: false,
    }
    window.studio.snapshot = { studioTools: { threads: true }, studioPeerRegistrationEnabled: true }
    window.refresh()
  })
  await waitCalls(1)
  assert.ok((await calls()).every((call) => call.url.endsWith('/api/retrieval/peers')))
  await page.evaluate(() => {
    window.calls = []
    delete window.studio.runtimes[0].snapshot.studioPeerRegistrationEnabled
    window.studio.runtimeRegistry.profiles[1].name = 'Older'
    window.refresh()
  })
  await waitCalls(1)
  assert.ok((await calls()).every((call) => call.url.endsWith('/api/retrieval/peers')))
  assert.deepEqual(errors, [])
  console.log(
    'Studio peer publication: headless HTTP access, source isolation, pending pairing exclusion, old/disabled hosts, stable streaming fingerprint and foreground-only mobile registration passed.',
  )
} finally {
  await browser.close()
}
