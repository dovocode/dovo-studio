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
import {Activity,memo,useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {WorkspaceValueProvider} from './packages/studio-core/src/workspace/selector';import {useWorkspace} from './packages/studio-core/src/workspace/context';
import {WorkspaceScope} from './packages/studio-core/src/workspace/scope';import {useCachedTask} from './packages/studio-core/src/workspace/use-cached-task';
const profile={id:'one',name:'One',connection:{address:'http://one',token:'first'}};const other={id:'two',name:'Two',connection:{address:'http://two',token:'second'}};
const history={id:'thread',files:[],messages:[{id:'m',role:'assistant',text:'cached history'}],turns:[]};const cache={read:async()=>({value:{snapshot:{workspace:{tasks:[history]}}}})};
const readRuntimeEffect=()=>Effect.void,refreshRuntime=async()=>{},runtimeReadCache=()=>cache;
window.renders=0;window.identities=[];
const Body=memo(function(){const context=useWorkspace();const recovered=useCachedTask(context.workspace.tasks[0]);window.renders++;window.identities.push(recovered.task);window.scopedSet=context.setWorkspace;return <section><output>{context.workspace.tasks[0]?.title}</output><textarea aria-label="Retained input" defaultValue="draft"/><div id="scroll" style={{height:80,overflow:'auto'}}><div style={{height:1000}}>Scroll state</div></div></section>});
function App(){const[hidden,setHidden]=useState(false);const[owner,setOwner]=useState(profile);const[active,setActive]=useState(profile);const[forgot,setForgot]=useState(false);const[workspace,setWorkspace]=useState({tasks:[{...history,title:'Before',messages:[],historyRevision:0}],repositories:[],agents:[],automations:[]});const[tick,setTick]=useState(0);window.hide=setHidden;window.update=()=>setWorkspace(w=>({...w,tasks:w.tasks.map(t=>({...t,title:'After'}))}));window.unrelated=()=>setTick(n=>n+1);window.switchHost=()=>setActive(other);window.rotate=()=>{const next={...profile,connection:{...profile.connection,token:'rotated'}};setOwner(next);setActive(next)};window.forget=()=>setForgot(true);window.root=workspace;const snapshot={workspace,detailTaskIds:[]};return <WorkspaceValueProvider value={{workspace,setWorkspace,snapshot,connection:active.connection,activeRuntimeId:active.id,runtimes:forgot?[]:[{profile:owner,snapshot,connected:true}],runtimeRegistry:{profiles:[owner,other]},readCache:cache,readRuntimeEffect,refreshRuntime,runtimeReadCache,connected:true,pendingMessages:()=>[],tick}}><WorkspaceScope profile={owner} suspended={hidden}><Activity mode={hidden?'hidden':'visible'}><Body/></Activity></WorkspaceScope></WorkspaceValueProvider>};createRoot(document.getElementById('app')).render(<App/>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { react: root + 'packages/studio-ui/node_modules/react' },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.error(e.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByRole('textbox', { name: 'Retained input' })
  await input.fill('Unsaved text')
  await page.waitForFunction(() => window.identities.at(-1)?.messages?.length === 1)
  const same = await page.evaluate(async () => {
    const before = window.identities.at(-1)
    window.unrelated()
    await new Promise((r) => requestAnimationFrame(r))
    return before === window.identities.at(-1)
  })
  assert.equal(same, true, 'Unrelated context update rebuilt cached history')
  await page.evaluate(() => {
    document.getElementById('scroll').scrollTop = 300
    window.oldSet = window.scopedSet
    window.hide(true)
  })
  await page.locator('section').waitFor({ state: 'hidden' })
  await page.evaluate(() => {
    window.frozenTask = window.identities.at(-1)
    window.identities = []
  })
  await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) {
      window.update()
      await new Promise(requestAnimationFrame)
    }
  })
  assert.equal(
    await page.evaluate(() => window.identities.every((value) => value === window.frozenTask)),
    true,
    'Hidden updates rebuilt cached history',
  )
  assert.equal(
    await page.locator('output').textContent(),
    'Before',
    'Hidden scope consumed unrelated workspace updates',
  )
  await page.evaluate(() => window.switchHost())
  await page.evaluate(() => new Promise(requestAnimationFrame))
  assert.match(
    await page.evaluate(() => {
      try {
        window.oldSet((w) => w)
        return 'allowed'
      } catch (e) {
        return e.message
      }
    }),
    /explicit workspace patch/,
  )
  await page.evaluate(() => window.hide(false))
  await input.waitFor()
  await page.getByText('After', { exact: true }).waitFor()
  assert.equal(await input.inputValue(), 'Unsaved text')
  assert.equal(await page.locator('#scroll').evaluate((el) => el.scrollTop), 300)
  await page.evaluate(() => {
    window.preRotateSet = window.scopedSet
    window.hide(true)
    window.rotate()
  })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  assert.match(
    await page.evaluate(() => {
      try {
        window.preRotateSet((w) => w)
        return 'allowed'
      } catch (e) {
        return e.message
      }
    }),
    /explicit workspace patch/,
  )
  await page.evaluate(() => window.forget())
  await page.locator('section').waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log(
    'Hidden workspace: no cached history reconstruction for 30 updates; activation catches up, input/scroll persist, cached history identity stays stable and old optimistic writes fail after host/token changes.',
  )
} finally {
  await browser.close()
}
