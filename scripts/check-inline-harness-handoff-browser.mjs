import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = root + 'packages/extension-tasks/src/chat/composer/'
const mobile = root + 'apps/mobile/src/tasks/detail/'
const controls = `
import {useImperativeHandle} from 'react';
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole==='alert'?'alert':undefined}>{children}</span>;
export const View=({children})=><div>{children}</div>;
export const Sheet=({children,ref,onClose})=>{useImperativeHandle(ref,()=>({dismiss:onClose}),[onClose]);return <section>{children}</section>};
export const Choice=()=>null;export const Field=()=>null;
export const useTheme=()=>({styles:{error:{},muted:{}}});
export const PermissionPolicyControls=()=>null;export const permissionPolicyUIIssue=()=>undefined;
export const ModelSettings=()=>null;
`
const browser = await chromium.launch()
try {
  for (const variant of ['thread', 'bot', 'turn', 'mobile', 'mobile-sheet', 'mobile-bot']) {
    const isMobile = variant.startsWith('mobile')
    const isBot = variant === 'bot' || variant === 'mobile-bot'
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
window.calls=[];window.flushes=0;window.fail=false;window.hold=false;window.settings=null;window.closes=0;window.deferDismissal=false;
const original={...(${isBot}?{bot:{role:'Helper',responsibilities:'Keep context',state:'active',revision:'11111111-1111-4111-8111-111111111111',createdAt:'',updatedAt:''}}:{}),id:'thread',title:'Thread',agentId:'',harness:defaultTaskHarness('codex'),providerLock:'codex',status:'review',checkoutLocked:true,createdAt:'',messages:[{id:'m',role:'user',text:'Saved context'}],files:[],draft:'Unsent draft'};
function App(){const[open,setOpen]=useState(true),[task,setTask]=useState(original),[connected,setConnected]=useState(true),[supported,setSupported]=useState(true),[scope,setScope]=useState('owner');window.task=task;window.setTask=patch=>setTask(t=>({...t,...patch}));window.setConnected=setConnected;window.setSupported=setSupported;window.setScope=setScope;window.reset=()=>{setOpen(true);window.settings=null;window.calls=[];setTask({...original});setScope('owner');setConnected(true);setSupported(true)};
const request=async(path,input)=>{window.calls.push({path,input:structuredClone(input),scope});if(window.hold)await new Promise(resolve=>window.release=resolve);if(window.fail){window.fail=false;setTask(t=>({...t,status:'review'}));throw Error('Reply lost')}setTask(t=>({...t,harness:input.harness,providerLock:input.harness.provider,status:'review'}));return{ok:true}};
const workspace={tasks:[task],agents:[],repositories:[]};const snapshot={workspace,threadHandoffsSupported:supported,permissionPolicySupported:true,acpInstallations:[]};
window.store={snapshot,workspace,connected,activeRuntimeId:scope,profile:{id:scope,connection:{address:'http://'+scope+'.local'}},connection:{address:'http://'+scope+'.local'},request,flush:async()=>{window.flushes++},setWorkspace:change=>{const next=change(workspace);setTask(next.tasks[0])},callEffect:(path,input)=>Effect.tryPromise({try:()=>request(path,input),catch:e=>e})};
return <>{(!${isMobile}||open)&&<Controls task={task} turn={!${isBot}&&task.status==='running'?{value:null,onChange:value=>window.settings=value}:undefined} agent={{...task.harness,id:'task',name:'Codex'}} disabled={false} value={window.settings} onChange={value=>window.settings=value} onClose={()=>{window.closes++;if(window.deferDismissal)window.finishDismissal=()=>setOpen(false);else setOpen(false)}} inline={${variant !== 'mobile-sheet'}}/>}<textarea aria-label="Message" value={task.draft} onChange={event=>setTask(task=>({...task,draft:event.target.value}))}/><output aria-label="Draft">{task.draft}</output><output aria-label="Provider">{task.harness.provider}</output></>}
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
    const editor = await page.getByRole('textbox', { name: 'Message', exact: true }).elementHandle()
    if (isMobile)
      await page.evaluate(() => {
        window.deferDismissal = true
      })
    await choose.click()
    await page.getByLabel('Provider').filter({ hasText: 'claude' }).waitFor()
    if (isMobile) {
      await page.waitForFunction(() => window.closes > 0 && !!window.finishDismissal)
      // A close callback is not a committed unmount. Hold the parent dismissal to
      // exercise that boundary, then wait for the actual panel to leave the DOM.
      assert.equal(await choose.count(), 1)
      await page.evaluate(() => {
        window.deferDismissal = false
        window.finishDismissal()
      })
      await choose.waitFor({ state: 'detached' })
      assert.equal(await page.getByText(/Harness switched\./).count(), 0)
    }
    assert.equal(await page.getByLabel('Draft').textContent(), 'Unsent draft')
    assert.equal(await page.evaluate(() => window.task.messages[0].text), 'Saved context')
    assert.equal(await page.evaluate(() => window.calls[0].input.stop), false)
    if (isMobile) {
      assert.equal(
        await editor.evaluate((element) => element.isConnected),
        true,
        'Dismissal must retain the mounted composer',
      )
      await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('Next message after switch')
      assert.equal(await page.getByLabel('Draft').textContent(), 'Next message after switch')
    }
    await page.evaluate(() => {
      window.reset()
      window.setTask({ status: 'running' })
    })
    await page.waitForFunction(() => window.task.status === 'running')
    // Persistent settings wait for the active run; per-message controls own running handoffs.
    if (variant !== 'thread' && !isBot) {
      await choose.click()
      assert.equal(await page.evaluate(() => window.calls.length), 0)
      await page.getByRole('button', { name: 'Stop and switch harness', exact: true }).click()
      await page.getByLabel('Provider').filter({ hasText: 'claude' }).waitFor()
      assert.equal(await page.evaluate(() => window.calls[0].input.stop), true)
      if (isMobile) await choose.waitFor({ state: 'detached' })
    } else {
      assert.equal(await choose.isDisabled(), true)
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
    if (isMobile) await choose.waitFor({ state: 'detached' })
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
        ': inline handoff, running guards, saved drafts/history, identical retry, queued-input and old-runtime guards passed.',
    )
  }
} finally {
  await browser.close()
}
