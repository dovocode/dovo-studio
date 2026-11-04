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
const mode=window.scenario;
const selections=input.catalogs?.runtime?{runtime:'runtime:remote'}:input.catalogs?.project?{project:mode==='terminal'?'none':'project:project-remote'}:input.catalogs?.model?{model:input.catalogs.model.find(item=>item.label.includes('Opus')).id}:{profile:'profile:work'};
result={mode,reason:'GLiClass suggestion',selections};
}else if(path==='/api/agents/availability')result=[{id:'harness:codex',available:true},{id:'agent:dovo:codex',available:true},{id:'agent:dovo:claude',available:true}];
else if(path==='/api/agents/models/cached')result={models:[{id:input.provider==='claude'?'claude-opus-5-5':'gpt-6.1-sol',name:input.provider==='claude'?'Opus 5.5':'Sol 6.1'}],reasoning:[]};
else if(path==='/api/previews/browser/profiles/read')result={profiles:[{id:'default',name:'Default'},{id:'work',name:'Work'}]};
else if(path==='/api/terminals/shells')result={shells:[{id:'default',label:'Default',path:'/bin/zsh',args:[]},{id:'fish',label:'Fish',path:'/bin/fish',args:[]}]};
else if(path==='/api/terminals/workspace')result={id:'shell',taskId:'studio:terminals',title:'Shell',exited:false};
else if(path==='/api/workspace')result={revision:1,applied:true,outcome:'applied',conflicts:[]};
else if(path==='/api/tasks/message')result={ok:true};
else throw Error('Unexpected endpoint '+path);
return decode(schema,result);
}};
createRoot(document.getElementById('app')).render(<WorkspaceInput onOpen={tab=>window.opened.push(tab)} onBrowser={async(url,target)=>window.pages.push({url,target})}/>);
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
export const cn=(...v)=>v.filter(Boolean).join(' ');
export const Button=({children,...props})=><button {...props}>{children}</button>;
export const ChoicePicker=({children,onValueChange,icons,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;
export const ComposerSurface=({children,controls,actions,error,onSubmit})=><form onSubmit={onSubmit}>{children}{controls}{actions}{error&&<p role="alert">{error}</p>}</form>;
export const ComposerSubmit=({busy,...props})=><button type="submit" {...props}/>;
export const ComposerTextarea=({preview,...props})=><textarea {...props}/>;
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
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
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
  assert.deepEqual(errors, [])
  console.log(
    'Workspace suggestions: owner/project/model inference, manual overrides, browser profiles and HTTP, explicit terminal execution passed.',
  )
} finally {
  await browser.close()
}
