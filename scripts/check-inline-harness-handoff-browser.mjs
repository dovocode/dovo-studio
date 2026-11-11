import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = root + 'packages/extension-tasks/src/chat/composer/'
const mobile = root + 'apps/mobile/src/tasks/detail/'
const controls = `
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole==='alert'?'alert':undefined}>{children}</span>;
export const View=({children})=><div>{children}</div>;
export const Sheet=({children})=><section>{children}</section>;
export const Choice=()=>null;export const Field=()=>null;
export const useTheme=()=>({styles:{error:{},muted:{}}});
export const PermissionPolicyControls=()=>null;export const permissionPolicyUIIssue=()=>undefined;
export const ModelSettings=()=>null;
`
const browser = await chromium.launch()
try {
  for (const variant of ['thread', 'turn', 'mobile']) {
    const isMobile = variant === 'mobile'
    const entry = isMobile
      ? mobile + 'harness-settings.tsx'
      : desktop + (variant === 'turn' ? 'turn-model-controls.tsx' : 'composer-harness-controls.tsx')
    const picker = `import {defaultTaskHarness} from '@dovo/protocol';export const ComposerSettingsControls=({lockedProvider,disabled,onChange})=><div><button disabled={disabled||!!lockedProvider} onClick={()=>void onChange({...defaultTaskHarness('claude'),model:'claude-test'})}>Choose Claude</button><button disabled={disabled} onClick={()=>void onChange({...defaultTaskHarness('codex'),model:'codex-test'})}>Choose Codex</button></div>;`
    const stubs = isMobile
      ? [
          { path: 'react-native', contents: controls },
          ...[
            '../../ui/controls/action',
            '../../ui/content/text',
            '../../ui/layout/sheet',
            '../../ui/controls/choice',
            '../../ui/controls/field',
            '../../ui/theme',
            '../../agents/model-settings',
            '../../agents/permission-policy-controls',
          ].map((path) => ({ path, importer: mobile, contents: controls })),
          {
            path: '../../runtime/connection/provider',
            importer: mobile,
            contents: 'export const useRuntime=()=>window.store;',
          },
          {
            path: '../../agents/use-harness-availability',
            importer: mobile,
            contents:
              'export const useHarnessAvailability=()=>({available:new Set(["harness:codex","harness:claude"]),loading:false});',
          },
          {
            path: '../../agents/harness-model-picker',
            importer: mobile,
            contents: `import {defaultTaskHarness} from '@dovo/protocol';export const HarnessModelPicker=({disabled,choices,onChange})=><button disabled={disabled||!choices.some(c=>c.id==='harness:claude')} onClick={()=>onChange('harness:claude',{...defaultTaskHarness('claude'),model:'claude-test',id:'task',name:'Claude'})}>Choose Claude</button>;`,
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export * from '@dovo/protocol';export {updateTask} from '${root}packages/studio-core/src/workspace/actions.ts';export const useWorkspace=()=>window.store;export const providers={codex:{short:'Codex'},claude:{short:'Claude'}};`,
          },
          {
            path: '@dovo/studio-ui',
            contents:
              picker +
              `export {Button} from '${root}packages/studio-ui/src/components/ui/button';export const permissionPolicyUIIssue=()=>undefined;`,
          },
          {
            path: '../../dialogs/harness-dialog',
            importer: desktop,
            contents: 'export const HarnessDialog=()=>null;',
          },
        ]
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {defaultTaskHarness} from '@dovo/protocol';import {${isMobile ? 'HarnessSettings' : variant === 'turn' ? 'TurnModelControls' : 'ComposerHarnessControls'} as Controls} from '${entry}';
window.calls=[];window.flushes=0;window.fail=false;window.hold=false;window.settings=null;
const original={id:'thread',title:'Thread',agentId:'',harness:defaultTaskHarness('codex'),providerLock:'codex',status:'review',checkoutLocked:true,createdAt:'',messages:[{id:'m',role:'user',text:'Saved context'}],files:[],draft:'Unsent draft'};
function App(){const[task,setTask]=useState(original),[connected,setConnected]=useState(true),[supported,setSupported]=useState(true),[scope,setScope]=useState('owner');window.task=task;window.setTask=patch=>setTask(t=>({...t,...patch}));window.setConnected=setConnected;window.setSupported=setSupported;window.setScope=setScope;window.reset=()=>{window.settings=null;window.calls=[];setTask({...original});setScope('owner');setConnected(true);setSupported(true)};
const request=async(path,input)=>{window.calls.push({path,input:structuredClone(input),scope});if(window.hold)await new Promise(resolve=>window.release=resolve);if(window.fail){window.fail=false;setTask(t=>({...t,status:'review'}));throw Error('Reply lost')}setTask(t=>({...t,harness:input.harness,providerLock:input.harness.provider,status:'review'}));return{ok:true}};
const workspace={tasks:[task],agents:[],repositories:[]};const snapshot={workspace,threadHandoffsSupported:supported,permissionPolicySupported:true,acpInstallations:[]};
window.store={snapshot,workspace,connected,activeRuntimeId:scope,profile:{id:scope,connection:{address:'http://'+scope+'.local'}},connection:{address:'http://'+scope+'.local'},request,flush:async()=>{window.flushes++},setWorkspace:change=>{const next=change(workspace);setTask(next.tasks[0])},callEffect:(path,input)=>Effect.tryPromise({try:()=>request(path,input),catch:e=>e})};
return <><Controls task={task} turn={task.status==='running'?{value:null,onChange:value=>window.settings=value}:undefined} agent={{...task.harness,id:'task',name:'Codex'}} disabled={false} value={window.settings} onChange={value=>window.settings=value} onClose={()=>{}} inline/><output aria-label="Draft">{task.draft}</output><output aria-label="Provider">{task.harness.provider}</output></>}
createRoot(document.getElementById('app')).render(<App/>);`,
        },
        bundle: true,
        write: false,
        format: 'iife',
        jsx: 'automatic',
        platform: 'browser',
        alias: {
          react: root + 'packages/studio-ui/node_modules/react',
          'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
          '@dovo/protocol': root + 'packages/protocol/src/index.ts',
        },
        nodePaths: [root + 'packages/studio-ui/node_modules', root + 'node_modules'],
      },
      stubs,
    )
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const choose = page.getByRole('button', { name: 'Choose Claude', exact: true })
    await choose.click()
    await page.getByLabel('Provider').filter({ hasText: 'claude' }).waitFor()
    assert.equal(await page.getByLabel('Draft').textContent(), 'Unsent draft')
    assert.equal(await page.evaluate(() => window.task.messages[0].text), 'Saved context')
    assert.equal(await page.evaluate(() => window.calls[0].input.stop), false)
    await page.evaluate(() => {
      window.reset()
      window.setTask({ status: 'running' })
    })
    // The regular thread control is disabled during a run; per-message controls own it.
    if (variant !== 'thread') {
      await choose.click()
      assert.equal(await page.evaluate(() => window.calls.length), 0)
      await page.getByRole('button', { name: 'Stop and switch harness', exact: true }).click()
      await page.getByLabel('Provider').filter({ hasText: 'claude' }).waitFor()
      assert.equal(await page.evaluate(() => window.calls[0].input.stop), true)
    }
    await page.evaluate(() => {
      window.reset()
      window.fail = true
    })
    await choose.click()
    await page.getByRole('alert').filter({ hasText: 'Reply lost' }).waitFor()
    const first = await page.evaluate(() => window.calls[0].input)
    await page.getByRole('button', { name: 'Retry harness switch', exact: true }).click()
    await page.getByLabel('Provider').filter({ hasText: 'claude' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.calls[1].input), first)
    await page.evaluate(() => {
      window.reset()
      window.hold = true
    })
    await page.getByLabel('Provider').filter({ hasText: 'codex' }).waitFor()
    await choose.evaluate((button) => {
      button.click()
      button.click()
    })
    await page.waitForFunction(() => window.calls.length === 1 && !!window.release)
    assert.equal(await choose.isDisabled(), true)
    await page.evaluate(() => window.setScope('another-runtime'))
    await page.waitForFunction(() => window.store.activeRuntimeId === 'another-runtime')
    await page.evaluate(() => {
      window.hold = false
      window.release()
    })
    await choose.waitFor()
    await page.waitForFunction(() => !document.body.textContent.includes('Switching…'))
    assert.equal(await page.evaluate(() => window.calls.length), 1)
    assert.equal(
      await page.getByText(/Harness switched\./).count(),
      0,
      'Old runtime reply showed success in another scope',
    )
    await page.evaluate(() => {
      window.reset()
      window.setTask({ draftTurnSettings: { model: 'draft-model' } })
    })
    await choose.click()
    await page.getByRole('alert').filter({ hasText: 'Use thread defaults' }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.length), 0)
    assert.equal(await page.evaluate(() => window.task.draftTurnSettings.model), 'draft-model')
    await page.evaluate(() => {
      window.reset()
      window.setTask({ queue: [{ id: 'queued' }] })
    })
    await choose.click()
    await page.getByRole('alert').filter({ hasText: 'queued messages' }).waitFor()
    assert.equal(await page.evaluate(() => window.calls.length), 0)
    await page.evaluate(() => {
      window.reset()
      window.setSupported(false)
    })
    await page.waitForFunction(() => window.store.snapshot.threadHandoffsSupported === false)
    assert.equal(await choose.isDisabled(), true)
    await page.evaluate(() => {
      window.reset()
      window.setConnected(false)
    })
    await page.waitForFunction(() => window.store.connected === false)
    if (isMobile) assert.equal(await choose.isDisabled(), true)
    else {
      await choose.click()
      assert.equal(await page.evaluate(() => window.calls.length), 0)
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      variant +
        ': inline handoff, explicit stop, saved drafts/history, identical retry, queued-input and old-runtime guards passed.',
    )
  }
} finally {
  await browser.close()
}
