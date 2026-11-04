import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const workspace = root + 'apps/mobile/src/workspace/'
const mobile = root + 'apps/mobile/src/'
const stubs = [
  {
    path: 'react-native',
    contents: `
export const Keyboard={dismiss(){}};
export const View=({children})=><div>{children}</div>;
export const ScrollView=View;
export const KeyboardAvoidingView=View;
export const Platform={OS:'web'};
export const TextInput=({accessibilityLabel,value,onChangeText,editable,placeholder,maxLength,onFocus,onBlur})=><textarea aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)} disabled={editable===false} placeholder={placeholder} maxLength={maxLength} onFocus={onFocus} onBlur={onBlur}/>;
export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;`,
  },
  { path: 'expo-crypto', contents: 'let id=0;export const randomUUID=()=>`workspace-${++id}`;' },
  {
    path: 'expo-router',
    contents: `export const router={navigate:target=>window.routes.push(target),replace:target=>window.routes.push(target),back:()=>window.routes.push('back')};`,
  },
  {
    path: '@react-native-async-storage/async-storage',
    contents: `export default {getItem:async key=>window.storage[key]??null,setItem:async(key,value)=>{window.storage[key]=value},removeItem:async key=>{delete window.storage[key]}};`,
  },
  {
    path: '../runtime/connection/provider',
    importer: workspace,
    contents: `import {useSyncExternalStore} from 'react';export const RuntimeScope=({children})=>children;export function useRuntime(){useSyncExternalStore(window.subscribe,()=>window.version);return {activeId:'a',overviews:window.owners,readRuntime:window.request,refreshRuntime:window.refresh}};`,
  },
  {
    path: '../shell/navigation',
    importer: workspace,
    contents: 'export const useNavigation=()=>({focused:window.focused});',
  },
  {
    path: '../ui/theme',
    importer: workspace,
    contents: 'export const useTheme=()=>({styles:{},colors:{}});',
  },
  {
    path: '../../ui/theme',
    importer: mobile + 'tasks/creation/',
    contents: 'export const useTheme=()=>({colors:{}});',
  },
  {
    path: '../ui/layout/glass',
    importer: workspace,
    contents: 'export const Glass=({children})=><div>{children}</div>;',
  },
  {
    path: '../ui/layout/screen-header',
    importer: workspace,
    contents: 'export const ScreenHeader=({title})=><h1>{title}</h1>;',
  },
  {
    path: '../ui/layout/sheet',
    importer: workspace,
    contents:
      'export const Sheet=({children,title,onClose})=><section role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close options</button></section>;',
  },
  {
    path: '../ui/controls/choice',
    importer: workspace,
    contents: `export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
  },
  {
    path: '../ui/controls/action',
    importer: workspace,
    contents:
      'export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;',
  },
  {
    path: '../ui/controls/icon-button',
    importer: workspace,
    contents:
      'export const IconButton=({label,onPress,disabled})=><button aria-label={label} onClick={onPress} disabled={disabled}>{label}</button>;',
  },
  {
    path: '../ui/controls/switch',
    importer: workspace,
    contents:
      'export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><input type="checkbox" aria-label={accessibilityLabel} checked={value} onChange={e=>onValueChange(e.target.checked)} disabled={disabled}/>;',
  },
  {
    path: '../ui/content/text',
    importer: workspace,
    contents:
      'export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;',
  },
  {
    path: '../../ui/content/text',
    importer: mobile + 'tasks/creation/',
    contents: 'export const Text=({children})=><span>{children}</span>;',
  },
  {
    path: '../../ui/controls/icon',
    importer: mobile + 'tasks/creation/',
    contents: 'export const Icon=()=>null;',
  },
  {
    path: './thread-starter-model',
    importer: workspace,
    contents: `export const ThreadStarterModel=({onChange})=><button onClick={()=>onChange({agentId:'',harness:{provider:'claude',model:'chosen',permission:'ask',args:[],env:{},instructions:'',endpoint:'',reasoning:''},harnessCustomized:true})}>Choose test model</button>;`,
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {BrowserWorkspaceProvider,useBrowserWorkspace} from './apps/mobile/src/browser/browser-workspace';
import {WorkspaceStarter} from './apps/mobile/src/workspace/workspace-starter';
window.storage={};window.routes=[];window.requests=[];window.focused=true;window.version=0;const listeners=new Set();window.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};
const owner=id=>({profile:{id,name:id,connection:{address:'http://'+id+'.lan',token:'private-'+id}},connected:true,snapshot:{terminalRecoverySupported:true,workspace:{repositories:[{id:'general-'+id,name:'General',kind:'scratch',path:'/scratch',branch:''},{id:'project',name:'Project '+id,path:'/project',branch:'main'}],agents:[],tasks:[{id:'existing-'+id,title:'Existing '+id}]}}});window.owners=[owner('a'),owner('b')];
window.publish=()=>{window.version++;listeners.forEach(fn=>fn())};
window.refresh=async()=>{if(window.failRefresh){window.failRefresh=false;throw Error('Refresh unavailable')}};
window.request=async(profile,path,input)=>{window.requests.push({owner:profile.id,path,input});
if(path==='/api/tasks/workspace/route'){if(window.holdRoute)await new Promise(resolve=>window.finishRoute=resolve);return window.decision??{mode:'terminal',reason:'A shell command'}};
if(path==='/api/terminals/shells')return {shells:[{id:'default',label:'Default '+profile.id,path:'/bin/zsh',args:[]},{id:'bash',label:'Bash '+profile.id,path:'/bin/bash',args:[]}]};
if(path==='/api/scm/branches')return {current:'main',branches:[{name:'main',ref:'refs/heads/main'}]};
if(path==='/api/scm/worktrees/choices')return {worktrees:[{path:'/worktree-'+profile.id,branch:'branch-'+profile.id}]};
if(path==='/api/terminals/workspace')return {id:'created-terminal',taskId:'studio:terminals',title:'Shell',exited:false};
if(path==='/api/workspace')return {revision:1,outcome:'applied'};
if(path==='/api/tasks/message'){if(window.failMessage){window.failMessage=false;throw Error('Lost message response')}return {ok:true}};
throw Error('Unexpected endpoint '+path)};
function App(){const[key,setKey]=useState(0);window.reset=()=>{window.requests=[];window.routes=[];window.focused=true;window.holdRoute=false;setKey(k=>k+1)};const browser=useBrowserWorkspace();window.tabs=browser.state.tabs;return <><WorkspaceStarter key={key} initialMode="auto"/><output aria-label="Saved tabs">{browser.state.tabs.length}</output></>};
createRoot(document.getElementById('app')).render(<BrowserWorkspaceProvider><App/></BrowserWorkspaceProvider>);`,
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
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  stubs,
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const request = page.getByRole('textbox', { name: 'Workspace request', exact: true })
  const reset = async () => {
    await page.evaluate(() => window.reset())
    await page.waitForFunction(
      () =>
        document.querySelector('select[aria-label="Destination"]')?.value === 'auto' &&
        document.querySelector('textarea')?.value === '',
    )
  }
  await request.fill('pnpm dev')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await page.getByText('Suggested terminal:', { exact: false }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.requests.filter((r) => r.path === '/api/terminals/workspace').length,
    ),
    0,
  )
  await page.getByLabel('Destination', { exact: true }).selectOption('browser')
  await page
    .getByRole('textbox', { name: 'Workspace request', exact: true })
    .fill('http://app.lan:3000')
  await page.getByRole('button', { name: 'Open browser', exact: true }).click()
  await page.waitForFunction(() => window.routes.includes('/workspace/browser'))
  assert.equal(await page.evaluate(() => window.tabs.at(-1).url), 'http://app.lan:3000/')

  await reset()
  await page.getByLabel('Destination', { exact: true }).selectOption('terminal')
  await page.getByLabel('Computer', { exact: true }).selectOption('b')
  await page.getByLabel('Shell', { exact: true }).selectOption('bash')
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click()
  await page.waitForFunction(() => window.routes.length)
  let created = await page.evaluate(() =>
    window.requests.find((r) => r.path === '/api/terminals/workspace'),
  )
  assert.equal(created.owner, 'b')
  assert.equal(created.input.repositoryId, undefined)
  assert.equal(created.input.shellId, 'bash')
  assert.equal(created.input.rememberSession, true)

  await reset()
  await page.getByLabel('Destination', { exact: true }).selectOption('terminal')
  await page.getByLabel('Project', { exact: true }).selectOption('project')
  await page.getByRole('button', { name: 'Workspace options', exact: true }).click()
  await page.getByLabel('Checkout', { exact: true }).selectOption('existing')
  await page.getByLabel('Worktree', { exact: true }).selectOption('/worktree-a')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('textbox', { name: 'Terminal command', exact: true }).fill('codex resume')
  await page.evaluate(() => {
    window.failRefresh = true
  })
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await page.getByText('Error: Refresh unavailable').waitFor()
  await page.getByRole('button', { name: 'Run command', exact: true }).click()
  await page.waitForFunction(() => window.routes.length)
  const launches = await page.evaluate(() =>
    window.requests.filter((r) => r.path === '/api/terminals/workspace'),
  )
  assert.equal(launches.length, 1)
  assert.equal(launches[0].input.execution, 'worktree')
  assert.equal(launches[0].input.existingWorktreePath, '/worktree-a')

  await reset()
  await page.getByLabel('Destination', { exact: true }).selectOption('thread')
  await page.getByRole('button', { name: 'Choose test model' }).click()
  await request.fill('Build the feature')
  await page.evaluate(() => {
    window.failMessage = true
  })
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.getByText('Thread saved.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Start thread', exact: true }).click()
  await page.waitForFunction(() => window.routes.length)
  const messages = await page.evaluate(() =>
    window.requests.filter((r) => r.path === '/api/tasks/message'),
  )
  assert.equal(messages.length, 2)
  assert.equal(messages[0].input.id, messages[1].input.id)
  assert.equal(messages[0].input.messageId, messages[1].input.messageId)
  const tasks = await page.evaluate(() =>
    window.requests.filter((r) => r.path === '/api/workspace'),
  )
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].input.create.harness.model, 'chosen')

  await reset()
  await page.getByLabel('Destination', { exact: true }).selectOption('thread')
  await page.getByRole('button', { name: 'Workspace options', exact: true }).click()
  await page.getByLabel('Thread destination', { exact: true }).selectOption('existing-a')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await request.fill('Continue this')
  await page.getByRole('button', { name: 'Send to thread', exact: true }).click()
  await page.waitForFunction(() => window.routes.length)
  assert.equal(
    await page.evaluate(() => window.requests.some((r) => r.path === '/api/workspace')),
    false,
  )
  assert.equal(
    await page.evaluate(
      () => window.requests.find((r) => r.path === '/api/tasks/message').input.id,
    ),
    'existing-a',
  )

  await reset()
  await page.evaluate(() => {
    window.holdRoute = true
  })
  await request.fill('A delayed decision')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await page.waitForFunction(() => !!window.finishRoute)
  await page.evaluate(() => {
    window.focused = false
    window.publish()
  })
  await page.evaluate(() => window.finishRoute())
  await page.getByRole('button', { name: 'Choose destination', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Destination', { exact: true }).inputValue(), 'auto')
  assert.equal(await page.evaluate(() => window.routes.length), 0)

  await reset()
  await page.evaluate(() => {
    window.holdRoute = true
    window.finishRoute = null
  })
  await request.fill('A decision on a replaced connection')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await page.waitForFunction(() => !!window.finishRoute)
  await page.evaluate(() => {
    window.owners = window.owners.map((owner) =>
      owner.profile.id === 'a'
        ? {
            ...owner,
            profile: {
              ...owner.profile,
              connection: { ...owner.profile.connection, address: 'http://replacement.lan' },
            },
          }
        : owner,
    )
    window.publish()
  })
  await page.evaluate(() => window.finishRoute())
  await page.getByRole('button', { name: 'Choose destination', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Destination', { exact: true }).inputValue(), 'auto')
  assert.equal(await page.evaluate(() => window.routes.length), 0)

  await reset()
  for (let i = 0; i < 8; i++)
    for (const mode of ['terminal', 'browser', 'thread', 'auto'])
      await page.getByLabel('Destination', { exact: true }).selectOption(mode)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile workspace: AI review/override, HTTP pages, remote shells, home/worktrees, recovery settings, safe retries, thread continuation and stale routing checks pass. Native controls use browser adapters.',
  )
} finally {
  await browser.close()
}
