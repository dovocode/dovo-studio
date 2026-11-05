import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const unified = root + 'packages/extension-tasks/src/unified/'
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {WorkspaceInput} from './packages/extension-tasks/src/unified/workspace-input';
import {decode,snapshotSchema,defaultTaskHarness} from '@dovo/protocol';
window.calls=[];window.opened=[];window.pages=[];window.scenario='thread';
const state=id=>decode(snapshotSchema,{workspaceRoutingSelectionsSupported:true,revision:0,owner:true,approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],defaults:{harness:defaultTaskHarness('codex')},workspace:{version:1,runtimeAddress:'',repositories:[{id:'general-'+id,kind:'scratch',name:'General',path:'/home',branch:''},{id:'project-'+id,name:id==='remote'?'Remote App':'Local App',path:'/app',branch:'main'}],agents:[],tasks:[],automations:[]}});
const owners=['local','remote'].map(id=>({profile:{id,name:id==='remote'?'Mac Studio':'This computer',connection:{address:'http://'+id+'.lan',token:'token'}},connected:true,snapshot:state(id)}));
window.store={runtimes:owners,activeRuntimeId:'local',localRuntimeId:'local',connected:true,snapshot:owners[0].snapshot,workspace:owners[0].snapshot.workspace,readRuntime:async(profile,path,input,schema)=>{
window.calls.push({owner:profile.id,path,input});let result;
if(path==='/api/tasks/workspace/route'){
if(window.routeGate)await window.routeGate;
if(window.routeError)throw Error('Classifier unavailable');
const mode=window.scenario;
const selections=input.catalogs?.runtime?{runtime:'runtime:remote'}:input.catalogs?.project?{project:mode==='terminal'?'none':'project:project-remote'}:input.catalogs?.model?{model:input.catalogs.model.find(item=>item.label.includes('Opus')).id}:{profile:'profile:work'};
result={mode,reason:'GLiClass suggestion',selections};
}else if(path==='/api/agents/availability')result=[{id:'harness:codex',available:true},{id:'agent:dovo:codex',available:true},{id:'agent:dovo:claude',available:true}];
else if(path==='/api/agents/models/cached')result={models:[{id:input.provider==='claude'?'claude-opus-5-5':'gpt-6.1-sol',name:input.provider==='claude'?'Opus 5.5':'Sol 6.1'}],reasoning:[]};
else if(path==='/api/previews/browser/profiles/read')result={profiles:[{id:'default',name:'Default'},{id:'work',name:'Work'}]};
else if(path==='/api/terminals/shells'){
if(window.shellGate)await window.shellGate;
if(window.shellError)throw Error('Shell catalog unavailable');
result={shells:[{id:'default',label:'Default',path:'/bin/zsh',args:[]},{id:'fish',label:'Fish',path:'/bin/fish',args:[]}]};
}
else if(path==='/api/terminals/workspace')result={id:'shell',taskId:'studio:terminals',title:'Shell',exited:false};
else if(path==='/api/workspace')result={revision:1,applied:true,outcome:'applied',conflicts:[]};
else if(path==='/api/tasks/message')result={ok:true};
else throw Error('Unexpected endpoint '+path);
return decode(schema,result);
}};
const root=createRoot(document.getElementById('app'));
window.refresh=()=>root.render(<WorkspaceInput active={window.active} onOpen={tab=>window.opened.push(tab)} onBrowser={async(url,target)=>window.pages.push({url,target})}/>);
window.refresh();
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [
      root + 'packages/extension-tasks/node_modules',
      root + 'packages/studio-ui/node_modules',
      root + 'node_modules',
    ],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {createTask} from '${root}packages/studio-core/src/workspace/actions';export {resolveTaskDefaults} from '@dovo/protocol';export const useWorkspace=()=>window.store;export const useAppPreferences=()=>({browserProfiles:[{id:'default',name:'Default'}]});export {responses} from '@dovo/protocol';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `
import {PromptInputTextarea} from '${root}packages/studio-ui/src/components/ai-elements/prompt-input';
export const cn=(...v)=>v.filter(Boolean).join(' ');
export const Button=({children,...props})=><button {...props}>{children}</button>;
export const ChoicePicker=({children,onValueChange,icons,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;
export const ComposerSurface=({children,controls,actions,error,onSubmit})=><form onSubmit={onSubmit}>{children}{controls}{actions}{error&&<p role="alert">{error}</p>}</form>;
export const ComposerSubmit=({busy,...props})=><button type="submit" {...props}/>;
export const ComposerTextarea=({preview,...props})=><PromptInputTextarea {...props}/>;
export const ComposerWorkspaceBar=({children})=><div>{children}</div>;
export const ProjectIcon=()=>null;`,
    },
    {
      path: '../task-creation/startup-heading',
      importer: unified,
      contents: 'export const StartupHeading=({children})=><div>{children}</div>;',
    },
    {
      path: '../terminal/terminal-recovery-control',
      importer: unified,
      contents: 'export const TerminalRecoveryControl=()=>null;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const mount = async (scenario) => {
    await page.goto('about:blank')
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.evaluate((mode) => {
      window.scenario = mode
    }, scenario)
  }
  await mount('thread')
  const request = page.getByLabel('Workspace request', { exact: true })
  await request.fill('Use Opus on Mac Studio in Remote App to fix the build')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await page.getByRole('button', { name: 'Start thread', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Workspace input computer').inputValue(), 'remote')
  assert.equal(await page.getByLabel('Workspace input project').inputValue(), 'project-remote')
  await page.waitForFunction(() =>
    document
      .querySelector('select[aria-label="Workspace thread model"]')
      ?.selectedOptions[0]?.textContent.includes('Opus'),
  )
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.path === '/api/workspace')),
    false,
    'Suggestions do not create a thread',
  )
  await page.getByLabel('Workspace thread model').selectOption('')
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.waitForFunction(
    () => window.opened.length === 1 || !!document.querySelector('[role=alert]'),
  )
  assert.equal(
    await page.getByRole('alert').count(),
    0,
    (await page.getByRole('alert').allTextContents()).join('\n'),
  )
  const created = await page.evaluate(() =>
    window.calls.find((call) => call.path === '/api/workspace'),
  )
  assert.equal(created.owner, 'remote')
  assert.equal(created.input.create.repositoryId, 'project-remote')
  assert.equal(
    created.input.create.harness.provider,
    'codex',
    'A manual model override wins over inference',
  )

  await page.evaluate(() => {
    window.scenario = 'browser'
  })
  await request.fill('open http://100.64.0.1:3000/?lol=1 in Work')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await page.getByRole('button', { name: 'Open browser', exact: true }).waitFor()
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="Workspace browser profile"]')?.value === 'work',
  )
  assert.equal(await page.evaluate(() => window.pages.length), 0)
  await page.getByLabel('Workspace browser profile').selectOption('default')
  await page.getByRole('button', { name: 'Open browser', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.pages), [
    { url: 'http://100.64.0.1:3000/?lol=1', target: { runtimeId: 'remote', profileId: 'default' } },
  ])

  await page.evaluate(() => {
    window.scenario = 'terminal'
  })
  await request.fill('printf "typed text"')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await page.getByRole('button', { name: 'Run command', exact: true }).waitFor()
  await page.getByLabel('Workspace terminal shell').selectOption('fish')
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => call.path === '/api/terminals/workspace'),
    ),
    false,
  )
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await page.waitForFunction(
    () => window.opened.length === 2 || !!document.querySelector('[role=alert]'),
  )
  assert.equal(
    await page.getByRole('alert').count(),
    0,
    (await page.getByRole('alert').allTextContents()).join('\n'),
  )
  const terminal = await page.evaluate(() =>
    window.calls.find((call) => call.path === '/api/terminals/workspace'),
  )
  assert.equal(terminal.owner, 'remote')
  assert.equal(terminal.input.command, 'printf "typed text"')
  assert.equal(terminal.input.repositoryId, undefined)
  assert.equal(terminal.input.shellId, 'fish')

  // The shortcut authorizes both inference and execution, using the freshly inferred context.
  await mount('thread')
  const threadText = 'Use Opus on Mac Studio in Remote App to fix the build'
  await request.fill(threadText)
  await request.dispatchEvent('keydown', { key: 'Enter', metaKey: true, isComposing: true })
  await request.dispatchEvent('keydown', { key: 'Enter', metaKey: true, repeat: true })
  await request.press('Meta+Shift+Enter')
  assert.equal(
    await page.evaluate(() => window.calls.length),
    0,
    'Composition, key repeat and Shift+Enter cannot start classification',
  )
  await request.fill(threadText)
  await request.press('Meta+Enter')
  await page.waitForFunction(() => window.opened.length === 1)
  const started = await page.evaluate(() => ({
    tasks: window.calls.filter((call) => call.path === '/api/workspace'),
    messages: window.calls.filter((call) => call.path === '/api/tasks/message'),
  }))
  assert.equal(started.tasks.length, 1)
  assert.equal(started.tasks[0].owner, 'remote')
  assert.equal(started.tasks[0].input.create.repositoryId, 'project-remote')
  assert.equal(started.tasks[0].input.create.harness.provider, 'claude')
  assert.equal(started.tasks[0].input.create.harness.model, 'claude-opus-5-5')
  assert.equal(started.messages.length, 1)
  assert.equal(started.messages[0].input.text, threadText)
  assert.equal(await request.inputValue(), '')

  await mount('browser')
  await request.fill('open http://100.64.0.1:3000/?lol=1 in Work')
  await request.press('Control+Enter')
  await page.waitForFunction(() => window.pages.length === 1)
  assert.deepEqual(await page.evaluate(() => window.pages), [
    { url: 'http://100.64.0.1:3000/?lol=1', target: { runtimeId: 'remote', profileId: 'work' } },
  ])

  await mount('terminal')
  await page.evaluate(() => {
    window.shellGate = new Promise((resolve) => {
      window.releaseShells = resolve
    })
  })
  await request.fill('ls -la')
  await request.press('Meta+Enter')
  await page.waitForFunction(() =>
    window.calls.some((call) => call.path === '/api/terminals/shells'),
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
    ),
    0,
    'Automatic start waits for the selected computer’s shell catalog',
  )
  await request.press('Meta+Enter')
  await request.dispatchEvent('keydown', { key: 'Enter', metaKey: true, repeat: true })
  await page.evaluate(() => window.releaseShells())
  await page.waitForFunction(() => window.opened.length === 1)
  const automaticTerminals = await page.evaluate(() =>
    window.calls.filter((call) => call.path === '/api/terminals/workspace'),
  )
  assert.equal(automaticTerminals.length, 1, 'Repeated shortcuts cannot execute twice')
  assert.equal(automaticTerminals[0].owner, 'remote')
  assert.equal(automaticTerminals[0].input.command, 'ls -la')
  assert.equal(automaticTerminals[0].input.shellId, 'default')
  assert.equal(await page.getByRole('alert').count(), 0)

  for (const delayed of ['route', 'shell']) {
    await mount('terminal')
    await page.evaluate((name) => {
      window[name + 'Gate'] = new Promise((resolve) => {
        window.releasePending = resolve
      })
    }, delayed)
    await request.fill('ls -la')
    await request.press('Control+Enter')
    const endpoint = delayed === 'route' ? '/api/tasks/workspace/route' : '/api/terminals/shells'
    await page.waitForFunction((path) => window.calls.some((call) => call.path === path), endpoint)
    await request.fill('keep this new draft')
    await page.evaluate(() => window.releasePending())
    await page.getByRole('button', { name: 'Choose destination', exact: true }).waitFor()
    assert.equal(await request.inputValue(), 'keep this new draft')
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
      ),
      0,
      `Draft edits cancel automatic start during ${delayed} loading`,
    )
  }

  await mount('terminal')
  await page.evaluate(() => {
    window.routeGate = new Promise((resolve) => {
      window.releasePending = resolve
    })
  })
  await request.fill('ls -la')
  await request.press('Meta+Enter')
  await page.waitForFunction(() =>
    window.calls.some((call) => call.path === '/api/tasks/workspace/route'),
  )
  await page.evaluate(() => {
    window.active = { kind: 'thread', runtimeId: 'local', id: 'another-thread' }
    window.refresh()
  })
  await page.evaluate(() => window.releasePending())
  await page.getByRole('button', { name: 'Run command', exact: true }).waitFor()
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="Workspace terminal shell"]')?.disabled,
  )
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.path === '/api/terminals/workspace').length,
    ),
    0,
    'Navigation cancels automatic start',
  )

  await mount('thread')
  await page.evaluate(() => {
    window.routeError = true
  })
  await request.fill(threadText)
  await request.press('Meta+Enter')
  await page.getByRole('alert').waitFor()
  assert.equal(await request.inputValue(), threadText)
  assert.equal(await page.evaluate(() => window.opened.length), 0)
  await page.evaluate(() => {
    window.routeError = false
  })
  await request.press('Meta+Enter')
  await page.waitForFunction(() => window.opened.length === 1)
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.path === '/api/workspace').length),
    1,
    'A failed shortcut can be retried without duplicate threads',
  )

  await mount('terminal')
  await page.evaluate(() => {
    window.shellError = true
  })
  await request.fill('ls -la')
  await request.press('Meta+Enter')
  await page.getByText(/Could not load shells: Shell catalog unavailable/).waitFor()
  assert.equal(await request.inputValue(), 'ls -la')
  assert.equal(await page.evaluate(() => window.opened.length), 0)
  await page.evaluate(() => {
    window.shellError = false
  })
  await page.getByRole('button', { name: 'Retry shells', exact: true }).click()
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="Workspace terminal shell"]')?.disabled,
  )
  assert.equal(
    await page.evaluate(() => window.opened.length),
    0,
    'Catalog errors cancel auto start',
  )
  await request.press('Control+Enter')
  await page.waitForFunction(() => window.opened.length === 1)
  assert.deepEqual(errors, [])
  console.log(
    'Workspace suggestions: inferred selections, overrides, HTTP, Cmd/Ctrl+Enter execution, delayed shells, stale drafts and retry checks passed.',
  )
} finally {
  await browser.close()
}
