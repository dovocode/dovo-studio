import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../packages/studio-ui/', import.meta.url).pathname
const native = `
export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;
export const Sheet=({title,children})=><div role="menu" aria-label={title}>{children}</div>;
export const Pressable=({children,accessibilityLabel,onPress,disabled})=><button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const useTheme=()=>({styles:{},colors:{}});
export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id} disabled={item.disabled}>{item.name}</option>)}</select>;
`
const mocks = {
  'react-native': native,
  '@dovo/studio-core': `export * from '../protocol/src/index';export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:value=>window.events.push(['navigate',value])});export const WorkspaceScope=({children})=>children;export {updateTask} from '../studio-core/src/workspace/actions';`,
  '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
  '@dovo/studio-ui': `export {Button} from './src/components/ui/button';export {Input} from './src/components/ui/input';export {ChoicePicker} from './src/choice-picker';export * from './src/components/ui/dialog';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export * as Popover from '@radix-ui/react-popover';export const ComposerWorkspaceBar=({children})=><div>{children}</div>;`,
  '@dovo/extension-scm/repository-dialog': `export const RepositoryDialog=()=>null;`,
  '../../list/task-collection': `export const taskSources=store=>[{runtimeId:'machine',name:'Machine',online:true,workspace:store.workspace}];`,
  '../../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../../runtime/connection/provider': `import {Effect} from 'effect';export const useRuntime=()=>({connected:true,callEffect:(path,input)=>Effect.tryPromise({try:()=>window.request(path,input),catch:error=>error})});`,
  '../../../shell/navigation': `export const useNavigation=()=>({navigate:(...args)=>window.events.push(['navigate',...args])});`,
  '../../../ui/controls/use-action': `import {useState} from 'react';export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState('');return {busy,error,act:callback=>{setBusy(true);return callback().catch(error=>setError(error.message)).finally(()=>setBusy(false))}}}`,
  '../../../ui/content/text': native,
  '../../../ui/layout/sheet': native,
  '../../../ui/controls/action': native,
  '../../../ui/controls/choice': native,
  '../../../ui/theme': native,
}
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {StartPullTask as DesktopStart} from '../extension-scm/src/pulls/list/start-task';
import {usePullTaskCreation} from '../../apps/mobile/src/scm/pulls/list/start-pull-task';
import {PullMenu} from '../../apps/mobile/src/scm/pulls/list/pull-menu';
function MobileStart({pull,stackAction}){const action=usePullTaskCreation('repo',pull);return <><PullMenu onRefresh={()=>{}} onOpen={()=>{}} onStartTask={action.start} prBranchAvailable={!!pull.headCloneUrl} actions={[]} onAction={()=>{}} actionDisabled={false} refreshDisabled={false} taskDisabled={action.busy}/><button onClick={()=>action.start('new-branch','update')}>Update stack</button>{action.error&&<p role="alert">{action.error}</p>}</>}
import {ComposerWorkspace} from '../extension-tasks/src/chat/composer/composer-workspace';
const root=createRoot(document.getElementById('app'));
const repository={id:'repo',name:'Project',path:'/repo',branch:'main'};
const pull={number:7,title:'Fix',url:'https://github.com/team/project/pull/7',head:'contributor:fix',base:'team:main',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),repositoryUrl:'https://github.com/team/project',headCloneUrl:'https://github.com/contributor/fork.git'};
window.request=async(path,input)=>{window.events.push(['request',path,input]);if(window.fail)throw Error('PR branch is already checked out');return {id:'task'}};
window.store={connected:true,workspace:{tasks:[],repositories:[repository],agents:[]},activeRuntimeId:'machine',runtimeRegistry:{profiles:[]},request:window.request};
window.render=(mobile,available=true,stack=false)=>{window.events=[];window.fail=false;flushSync(()=>root.render(null));const source={...pull,headCloneUrl:available?pull.headCloneUrl:undefined};flushSync(()=>root.render(mobile?<MobileStart repositoryId="repo" pull={source} stackAction={stack?'update':undefined}/>:<DesktopStart repositoryId="repo" pull={source} stackAction={stack?'update':undefined}/>));};
window.composer=(checkoutMode,legacy=false)=>{const task={id:'task',title:'Draft',repositoryId:'repo',agentId:'',status:'draft',execution:'worktree',worktreeFromOrigin:true,messages:[],files:[],draft:'',example:false,pullRequest:{...pull,headBranch:legacy?undefined:pull.head,checkoutMode}};flushSync(()=>root.render(<ComposerWorkspace task={task} disabled={false} onMachineMoving={()=>{}}/>));};
window.render(false);
`,
  },
  plugins: [
    {
      name: 'pr-task-checkout-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir,
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
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const mobile of [false, true]) {
    for (const mode of ['new-branch', 'pr-branch']) {
      await page.evaluate((mobile) => window.render(mobile), mobile)
      await page
        .getByRole('button', { name: mobile ? 'PR actions' : 'New task', exact: true })
        .click()
      assert.equal(await page.getByRole('dialog').count(), 0)
      await page
        .getByRole(mobile ? 'button' : 'menuitem', {
          name: mode === 'pr-branch' ? 'Use PR branch' : 'New branch from PR',
          exact: true,
        })
        .click()
      await page.waitForFunction(() => window.events.some((event) => event[0] === 'navigate'))
      const request = await page.evaluate(() =>
        window.events.find((event) => event[0] === 'request'),
      )
      assert.equal(request[1], '/api/scm/pulls/task')
      assert.equal(request[2].checkoutMode, mode)
      assert.equal(request[2].objective, 'I want to work on this PR.')
      assert.equal(request[2].run, false)
    }
    await page.evaluate((mobile) => {
      window.render(mobile)
      window.fail = true
    }, mobile)
    await page
      .getByRole('button', { name: mobile ? 'PR actions' : 'New task', exact: true })
      .click()
    await page
      .getByRole(mobile ? 'button' : 'menuitem', { name: 'Use PR branch', exact: true })
      .click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByRole('alert').textContent(), 'PR branch is already checked out')
    assert.equal(
      await page.evaluate(() => window.events.some((event) => event[0] === 'navigate')),
      false,
    )
    await page.evaluate(() => {
      window.fail = false
    })
    await page
      .getByRole('button', { name: mobile ? 'PR actions' : 'New task', exact: true })
      .click()
    await page
      .getByRole(mobile ? 'button' : 'menuitem', { name: 'New branch from PR', exact: true })
      .click()
    await page.waitForFunction(() => window.events.some((event) => event[0] === 'navigate'))
    await page.evaluate((mobile) => window.render(mobile, false), mobile)
    await page
      .getByRole('button', { name: mobile ? 'PR actions' : 'New task', exact: true })
      .click()
    const direct = page.getByRole(mobile ? 'button' : 'menuitem', {
      name: 'Use PR branch',
      exact: true,
    })
    assert.equal(
      mobile ? await direct.isDisabled() : (await direct.getAttribute('aria-disabled')) === 'true',
      true,
    )
    await page.evaluate((mobile) => window.render(mobile, true, true), mobile)
    await page
      .getByRole('button', { name: mobile ? 'Update stack' : 'New task', exact: true })
      .click()
    if (!mobile) await page.getByRole('menuitem', { name: 'Update PR stack', exact: true }).click()
    await page.waitForFunction(() => window.events.some((event) => event[0] === 'navigate'))
    const stackRequest = await page.evaluate(
      () => window.events.find((event) => event[0] === 'request')[2],
    )
    assert.equal(stackRequest.stackAction, 'update')
    assert.equal(stackRequest.checkoutMode, 'new-branch')
  }
  for (const [mode, legacy, label] of [
    ['new-branch', false, 'From contributor:fix'],
    ['pr-branch', false, 'PR branch contributor:fix'],
    ['new-branch', true, 'From PR #7'],
  ]) {
    await page.evaluate(([mode, legacy]) => window.composer(mode, legacy), [mode, legacy])
    assert.equal(
      (await page.getByRole('button', { name: 'Checkout branch', exact: true }).innerText()).trim(),
      label,
    )
    assert.equal(
      await page.getByRole('button', { name: 'Checkout branch', exact: true }).isDisabled(),
      true,
    )
    assert.equal(await page.getByText('New worktree', { exact: true }).isVisible(), true)
  }
  assert.deepEqual(errors, [])
  console.log(
    'Desktop/native-adapted PR menus choose separate or direct PR branches, retain short instructions, disable unavailable sources, and display PR bases instead of origin.',
  )
} finally {
  await browser.close()
}
