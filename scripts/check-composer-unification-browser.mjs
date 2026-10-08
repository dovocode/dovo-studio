import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const screenshotDirectory = process.env.DOVO_COMPOSER_SCREENSHOTS
const css = screenshotDirectory
  ? readdirSync(root + 'apps/desktop/dist/assets')
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'))
      .join('\n')
  : ''
if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true })

const mocks = {
  '@dovo/studio-core': `
    import {createContext,useContext} from 'react';
    export * from '@dovo/protocol';
    export {providers} from '../studio-core/src/providers';
    export {studioSyntaxTheme} from '../studio-core/src/themes';
    export {WorkspaceContext as Context,useWorkspace} from '../studio-core/src/workspace/context';
    export {WorkspaceScope} from '../studio-core/src/workspace/scope';
    export const Preferences=createContext({});
    export const useAppPreferences=()=>useContext(Preferences);
    export const useResolvedTheme=()=> 'dark';
    export const useStudioHost=()=>({registerCommand:()=>()=>{}});
  `,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `
    export {ComposerSurface,ComposerTextarea,ComposerSubmit,ComposerWorkspaceBar} from './src/composer-surface';
    export {ComposerSettingsControls} from './src/composer-settings-controls';
    export {ModelSettings} from './src/model-settings';
    export {Button} from './src/components/ui/button';
    export {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './src/components/ui/dialog';
  `,
}
const built = await build({
  stdin: {
    contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Effect} from 'effect';
      import {Context,Preferences,decode,snapshotSchema,runtimeProfile,defaultTaskHarness} from '@dovo/studio-core';
      import {TaskLauncherForm} from '../studio-shell/src/task-launcher';
      const profiles=['one','two'].map(id=>({...runtimeProfile({address:'http://'+id,token:'test-token-at-least-twenty-characters'}),id,name:id,nameIsCustom:true}));
      const snapshots=Object.fromEntries(profiles.map(profile=>[profile.id,decode(snapshotSchema,{
        revision:0,owner:true,approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],
        runtimeHost:profile.id,
        defaults:{harness:{...defaultTaskHarness('codex'),model:'gpt-6.1-sol',reasoning:'xhigh',permission:'full-access'}},
        workspace:{version:1,runtimeAddress:'',agents:[],tasks:[],automations:[],repositories:[
          {id:profile.id+'-repo',name:'dovo-studio',path:'/repo',branch:'main',gitIdentity:'github.com/team/dovo-studio'},
          {id:profile.id+'-other',name:'Another project',path:'/other',branch:'main',gitIdentity:'github.com/team/another'}
        ]}
      })]));
      window.requests=[];window.pendingSnapshots=[];window.holdSnapshots=false;window.failNextSnapshot=false;window.pendingMessage=null;window.dismissed=0;
      const readRuntime=async(profile,path,input)=>{
        window.requests.push({runtime:profile.id,path,input});
        if(path==='/api/snapshot'&&window.failNextSnapshot){window.failNextSnapshot=false;throw Error('Computer unavailable')}
        if(path==='/api/snapshot')return window.holdSnapshots?new Promise(resolve=>window.pendingSnapshots.push(()=>resolve(snapshots[profile.id]))):snapshots[profile.id];
        if(path==='/api/agents/models')return {models:[{id:'gpt-6.1-sol',name:'GPT-6.1-Sol',isDefault:true,defaultReasoning:'xhigh',reasoning:[{id:'high',name:'High'},{id:'xhigh',name:'Extra High'}],serviceTiers:[{id:'priority',name:'Fast'}]}],reasoning:[],codex:{fastModeBlocked:false,daybreakPrograms:[]}};
        if(path==='/api/agents/availability')return [{id:'harness:codex',available:true}];
        if(path==='/api/workspace')return {revision:1};
        if(path==='/api/tasks/message')return new Promise((resolve,reject)=>{window.pendingMessage={resolve,reject}});
        throw Error('Unexpected request '+path);
      };
      let openLauncher=()=>{};
      const bridge={subscribe:listener=>{openLauncher=listener;return ()=>{}},dismiss:async()=>{window.dismissed++}};
      window.openLauncher=()=>openLauncher();
      const value={workspace:snapshots.one.workspace,snapshot:snapshots.one,connected:true,connection:profiles[0].connection,
        runtimeRegistry:{profiles,activeId:'one'},activeRuntimeId:'one',runtimes:profiles.map(profile=>({profile,snapshot:snapshots[profile.id],connected:true})),
        readRuntime,readRuntimeEffect:(...args)=>Effect.tryPromise(()=>readRuntime(...args)),
        refreshRuntime:async()=>{},runtimeReadCache:()=>null,setWorkspace:()=>{throw Error('Launcher wrote workspace state')}
      };
      function App(){const [preferences,setPreferences]=useState({sendWith:'enter',markdownComposerPreview:false,themePalette:'dovo'});window.setPreferences=next=>setPreferences(current=>({...current,...next}));return <Preferences.Provider value={preferences}><Context.Provider value={value}><TaskLauncherForm bridge={bridge}/></Context.Provider></Preferences.Provider>}
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    resolveDir: root + 'packages/studio-ui/',
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'launcher-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'launcher-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'launcher-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: root + 'packages/studio-ui/',
          loader: 'tsx',
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 670 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.route('http://dovo.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html class="dark"><div id="app"></div></html>',
    }),
  )
  await page.goto('http://dovo.test/')
  if (css) await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const input = page.getByRole('textbox', { name: 'Task prompt' })
  const send = page.getByRole('button', { name: 'Start task', exact: true })
  const server = page.getByRole('combobox', { name: 'Server', exact: true })
  const project = page.getByRole('combobox', { name: 'Project', exact: true })
  const reasoning = page.getByRole('button', { name: 'Reasoning and speed' })
  const access = page.getByRole('button', { name: 'Configure task permissions' })
  const creationCount = () =>
    page.evaluate(() => window.requests.filter((r) => r.path === '/api/workspace').length)
  await reasoning.waitFor()
  assert(await send.isDisabled(), 'Empty draft enabled dispatch')
  assert(
    await input.evaluate((element) => element === document.activeElement),
    'Launcher did not focus the editor',
  )
  await input.fill('Make it uniform and use this one and the styling')

  const screenshot = async (name, width) => {
    if (!screenshotDirectory) return
    await page.setViewportSize({ width, height: 670 })
    await input.focus()
    // Wait for layout and button transitions before inspecting the painted state.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Composer overflowed the viewport',
    )
    const form = page.locator('.studio-composer')
    const formBounds = await form.boundingBox()
    for (const button of [send, reasoning, access]) {
      const bounds = await button.boundingBox()
      assert(
        bounds.x >= formBounds.x && bounds.x + bounds.width <= formBounds.x + formBounds.width + 1,
        'Toolbar control overflowed the composer',
      )
    }
    await page.screenshot({ path: screenshotDirectory + '/' + name + '.png' })
  }
  await screenshot('launcher-dark', 800)
  await screenshot('launcher-window', 620)
  await screenshot('launcher-narrow', 460)
  if (css) {
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))
    await screenshot('launcher-light', 800)
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  }

  await page.getByRole('button', { name: 'Choose agent and model', exact: true }).click()
  await page.getByRole('button', { name: 'Agent configuration', exact: true }).click()
  const configuration = page.getByRole('dialog', { name: 'Agent configuration', exact: true })
  await configuration.waitFor()
  await configuration.getByRole('button', { name: 'Close', exact: true }).click()
  assert((await input.inputValue()).startsWith('Make it uniform'), 'Configuration lost the draft')

  await input.press('Shift+Enter')
  assert((await input.inputValue()).endsWith('\n'), 'Shift+Enter did not insert a newline')
  await input.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }),
    ),
  )
  assert.equal(await creationCount(), 0, 'IME composition submitted the draft')
  await page.evaluate(() => window.setPreferences({ markdownComposerPreview: true }))
  await page.getByLabel('Formatted message preview').waitFor()
  await page.evaluate(() => window.setPreferences({ markdownComposerPreview: false }))
  await project.selectOption({ label: 'Another project' })
  assert(
    (await input.inputValue()).startsWith('Make it uniform'),
    'Project selection lost the draft',
  )

  await page.evaluate(() => (window.holdSnapshots = true))
  await server.selectOption('two')
  await page.waitForFunction(() => window.pendingSnapshots.length === 1)
  assert(await send.isDisabled(), 'Dispatch remained enabled while switching computers')
  await server.selectOption('one')
  await page.waitForFunction(() => window.pendingSnapshots.length === 2)
  await page.evaluate(() => window.pendingSnapshots[0]())
  assert(await send.isDisabled(), 'Stale computer response enabled dispatch')
  await page.evaluate(() => {
    window.pendingSnapshots[1]()
    window.holdSnapshots = false
  })
  await reasoning.waitFor()
  await server.selectOption('two')
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="Project"]').value === 'github.com/team/another',
  )
  await reasoning.waitFor()
  assert(
    (await input.inputValue()).startsWith('Make it uniform'),
    'Computer selection lost the draft',
  )

  await page.evaluate(() => (window.failNextSnapshot = true))
  await server.selectOption('one')
  await page.getByRole('alert').filter({ hasText: 'Computer unavailable' }).waitFor()
  assert(await send.isDisabled(), 'Unavailable computer enabled dispatch')
  assert(
    (await input.inputValue()).startsWith('Make it uniform'),
    'Connection failure lost the draft',
  )
  await page.getByRole('button', { name: 'Retry server connection', exact: true }).click()
  await reasoning.waitFor()
  await server.selectOption('two')
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="Project"]').value === 'github.com/team/another',
  )
  await reasoning.waitFor()

  await project.selectOption({ label: 'dovo-studio' })
  await reasoning.click()
  await page.getByRole('menuitemradio', { name: 'High', exact: true }).click()
  await reasoning.click()
  await page.getByRole('menuitemradio', { name: 'Fast', exact: true }).click()
  await access.click()
  await page.locator('[role="menuitemradio"][data-value="workspace-write"]').click()
  await input.fill('Keep the same task when retrying')
  await input.press('Enter')
  await page.waitForFunction(() => window.pendingMessage !== null)
  await input.press('Escape')
  assert.equal(await page.getByRole('dialog', { name: 'Start a task', exact: true }).count(), 1)
  assert(await input.isDisabled(), 'In-flight draft was editable')
  assert(await server.isDisabled(), 'In-flight computer selection was editable')
  const creation = await page.evaluate(() =>
    window.requests.find((r) => r.path === '/api/workspace'),
  )
  assert.equal(creation.runtime, 'two')
  assert.equal(creation.input.create.repositoryId, 'two-repo')
  assert.equal(creation.input.create.harness.reasoning, 'high')
  assert.equal(creation.input.create.harness.serviceTier, 'priority')
  assert.equal(creation.input.create.harness.permission, 'workspace-write')
  await page.evaluate(() => {
    window.pendingMessage.reject(new Error('Response lost'))
    window.pendingMessage = null
  })
  await page.getByRole('alert').filter({ hasText: 'Response lost' }).waitFor()
  assert.equal(await input.inputValue(), 'Keep the same task when retrying')
  assert(await input.isDisabled(), 'Retry allowed changing the original submission')
  await page.getByRole('button', { name: 'Retry dispatch', exact: true }).click()
  await page.waitForFunction(() => window.pendingMessage !== null)
  const messages = await page.evaluate(() =>
    window.requests.filter((r) => r.path === '/api/tasks/message'),
  )
  assert.deepEqual(messages[0], messages[1], 'Retry changed the message or destination')
  assert.equal(await creationCount(), 1, 'Retry created another task')
  await page.evaluate(() => {
    window.pendingMessage.resolve({ ok: true })
    window.pendingMessage = null
  })
  await page.waitForFunction(() => window.dismissed === 1)

  await page.evaluate(() => {
    window.setPreferences({ sendWith: 'mod-enter' })
    window.openLauncher()
  })
  await reasoning.waitFor()
  await input.fill('Use the keyboard preference')
  await input.press('Enter')
  assert.equal(await creationCount(), 1, 'Plain Enter ignored the keyboard preference')
  assert(
    (await input.inputValue()).endsWith('\n'),
    'Plain Enter did not add a line in modifier mode',
  )
  await input.press('Control+Enter')
  await page.waitForFunction(() => window.pendingMessage !== null)
  assert.equal(await creationCount(), 2, 'Control+Enter did not dispatch')
  await page.evaluate(() => window.pendingMessage.resolve({ ok: true }))
  await page.waitForFunction(() => window.dismissed === 2)
  assert.deepEqual(errors, [])
  console.log(
    'Shared composer: focus, keyboard preference, IME, preview, remote switching, settings and retry identity passed.',
  )
} finally {
  await browser.close()
}
