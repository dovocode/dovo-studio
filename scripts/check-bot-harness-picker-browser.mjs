import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const desktop = root + 'packages/extension-tasks/src/'
const native = `
import {useImperativeHandle} from 'react';
export const View=({children})=><div>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityRole})=><button aria-label={accessibilityLabel} role={accessibilityRole} disabled={disabled} onClick={onPress}>{children}</button>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Choice=({label,items,value,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const Field=()=>null;export const Icon=()=>null;export const HarnessIcon=()=>null;export const Switch=()=>null;
export const Sheet=({children,ref,onClose})=>{useImperativeHandle(ref,()=>({dismiss:onClose}),[onClose]);return <section>{children}</section>};
export const useTheme=()=>({styles:{},colors:{}});
export const ModelSettings=()=>null;export const PermissionPolicyControls=()=>null;export const permissionPolicyUIIssue=()=>undefined;
`
const browser = await chromium.launch()
try {
  for (const platform of ['mobile', 'desktop']) {
    const isMobile = platform === 'mobile'
    const stubs = isMobile
      ? [
          { path: 'react-native', contents: native },
          ...['action', 'choice', 'field', 'icon', 'switch'].map((name) => ({
            path: '../ui/controls/' + name,
            importer: mobile + 'agents/',
            contents: native,
          })),
          { path: '../ui/content/text', importer: mobile + 'agents/', contents: native },
          { path: '../ui/theme', importer: mobile + 'agents/', contents: native },
          { path: './harness-icon', importer: mobile + 'agents/', contents: native },
          ...[
            '../../ui/controls/action',
            '../../ui/controls/choice',
            '../../ui/controls/field',
            '../../ui/content/text',
            '../../ui/theme',
            '../../ui/layout/sheet',
            '../../agents/model-settings',
            '../../agents/permission-policy-controls',
          ].map((path) => ({ path, importer: mobile + 'tasks/detail/', contents: native })),
          ...[
            ['../../runtime/connection/provider', mobile + 'tasks/detail/'],
            ['../runtime/connection/provider', mobile + 'agents/'],
          ].map(([path, importer]) => ({
            path,
            importer,
            contents: 'export const useRuntime=()=>window.store;',
          })),
          {
            path: '../../agents/use-harness-availability',
            importer: mobile + 'tasks/detail/',
            contents:
              'export const useHarnessAvailability=()=>({available:new Set(["harness:opencode","harness:claude","harness:codex"]),loading:false});',
          },
          {
            path: './use-model-catalog',
            importer: mobile + 'agents/',
            contents:
              'export const useModelCatalog=agent=>({catalog:{models:[{id:agent.provider+"-model",name:agent.provider+" model"}],reasoning:[]},modelName:agent.model,loading:false,canDiscover:true,refresh:()=>{}});',
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export * from '@dovo/protocol';export const useWorkspace=()=>window.store;export {updateTask} from '${root}packages/studio-core/src/workspace/actions.ts';export const providers={opencode:{short:'OpenCode'},claude:{short:'Claude'}};`,
          },
          {
            path: '@dovo/studio-core/state',
            contents: "export {useState as useApplicationState} from 'react';",
          },
          {
            path: '../harness-fields',
            importer: desktop + 'dialogs/',
            contents: `import {defaultTaskHarness} from '@dovo/protocol';export const HarnessFields=({lockedProvider,onChange})=><button disabled={!!lockedProvider} onClick={()=>onChange(defaultTaskHarness('claude'))}>Choose Claude harness</button>;`,
          },
          {
            path: '@dovo/studio-ui',
            contents: `export const Button=({children,...props})=><button {...props}>{children}</button>;export const Dialog=({children})=><div>{children}</div>;export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog,DialogFooter=Dialog;export const ModelSettings=()=>null,FormField=Dialog,ChoicePicker=Dialog,PermissionPolicyFields=()=>null;export const permissionPolicyUIIssue=()=>undefined;`,
          },
        ]
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {defaultTaskHarness} from '@dovo/protocol';
import {${isMobile ? 'HarnessSettings' : 'HarnessDialog'} as Controls} from '${isMobile ? mobile + 'tasks/detail/harness-settings.tsx' : desktop + 'dialogs/harness-dialog.tsx'}';
window.calls=[];window.closes=0;
const initial={id:'bot',title:'Dory',repositoryId:'',agentId:'',status:'draft',providerLock:'opencode',checkoutLocked:true,harness:defaultTaskHarness('opencode'),messages:[],files:[],draft:'Keep draft',createdAt:'',example:false,bot:{role:'Manager',responsibilities:'Help',state:'active',revision:'11111111-1111-4111-8111-111111111111',createdAt:'',updatedAt:''}};
function App(){const[task,setTask]=useState(initial);window.task=task;window.reset=patch=>{window.calls=[];setTask({...initial,...patch})};
const request=async(path,input)=>{window.calls.push({path,input});if(window.fail){window.fail=false;throw Error('Switch failed')}if(path.endsWith('/pending-harness'))setTask(t=>({...t,pendingHarness:{id:input.requestId,harness:input.harness}}));else setTask(t=>({...t,harness:input.harness,providerLock:input.harness.provider,status:'review'}));return{ok:true}};
const workspace={tasks:[task],agents:[],repositories:[]};window.store={workspace,snapshot:{workspace,threadHandoffsSupported:true,pendingBotHarnessSupported:true,permissionPolicySupported:true,acpInstallations:[]},connected:true,activeRuntimeId:'owner',profile:{id:'owner',name:'Owner',connection:{address:'http://owner.local'}},flush:async()=>{},request,callEffect:(path,input)=>Effect.tryPromise({try:()=>request(path,input),catch:e=>e}),setWorkspace:()=>{throw Error('Provider switch must use the handoff endpoint')}};
return <Controls key={task.id} task={task} onClose={()=>window.closes++}/>};createRoot(document.getElementById('app')).render(<App/>);
`,
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
        nodePaths: [root + 'node_modules', root + 'packages/studio-ui/node_modules'],
      },
      stubs,
    )
    const page = await browser.newPage({ viewport: { width: isMobile ? 390 : 1280, height: 844 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const choose = page.getByRole('button', {
      name: isMobile ? 'claude model' : 'Choose Claude harness',
      exact: true,
    })
    if (isMobile) {
      assert.deepEqual(await page.getByLabel('Filter models').locator('option').allTextContents(), [
        'All providers',
        'Favorites',
        'Saved agents',
        'Codex',
        'OpenCode',
        'Claude',
      ])
      await page.getByRole('button', { name: 'codex model', exact: true }).waitFor()
    }
    await choose.click()
    if (!isMobile) await page.getByRole('button', { name: 'Save harness', exact: true }).click()
    await page.waitForFunction(() => window.task.harness.provider === 'claude')
    assert.equal(await page.evaluate(() => window.calls[0].path), '/api/tasks/continue-harness')
    assert.equal(await page.evaluate(() => window.task.draft), 'Keep draft')
    assert.equal(await page.evaluate(() => window.task.bot.role), 'Manager')
    await page.evaluate(() => window.reset({ id: 'busy-bot', status: 'running' }))
    await choose.click()
    if (!isMobile) await page.getByRole('button', { name: 'Save harness', exact: true }).click()
    await page.waitForFunction(() => window.calls[0]?.path === '/api/tasks/pending-harness')
    assert.equal(await page.evaluate(() => window.task.harness.provider), 'opencode')
    assert.equal(await page.evaluate(() => window.task.status), 'running')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      platform + ': fresh Bot provider selection and deferred active-turn switching passed.',
    )
  }
} finally {
  await browser.close()
}
