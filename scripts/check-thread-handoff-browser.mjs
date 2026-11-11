import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const native = `
export const View=({children,accessibilityLiveRegion})=><div aria-live={accessibilityLiveRegion}>{children}</div>;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const StyleSheet={hairlineWidth:1};
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><input type="checkbox" aria-label={accessibilityLabel} checked={value} disabled={disabled} onChange={event=>onValueChange(event.target.checked)}/>;
export const Sheet=({title,children})=><section role="dialog" aria-label={title}>{children}</section>;
export const useTheme=()=>({colors:{border:'#444'},styles:{text:{},muted:{},error:{}}});
`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const dialogPath = mobile
      ? 'apps/mobile/src/tasks/detail/continue-elsewhere'
      : 'packages/extension-tasks/src/dialogs/continue-elsewhere-dialog'
    const noticePath = mobile
      ? 'apps/mobile/src/tasks/detail/machine-handoff-notice'
      : 'packages/extension-tasks/src/detail/machine-handoff-notice'
    const importer = root + dialogPath
    const noticeImporter = root + noticePath
    const shared = `export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:target=>window.opened=target});export * from './packages/protocol/src/index';export const providers={codex:{short:'Codex'},claude:{short:'Claude'}};`
    const ui = `
export {Button} from './packages/studio-ui/src/components/ui/button';
export {Checkbox} from './packages/studio-ui/src/components/ui/checkbox';
export * from './packages/studio-ui/src/components/ui/dialog';
export const permissionPolicyUIIssue=()=>undefined;
`
    const stubs = mobile
      ? [
          { path: 'react-native', contents: native },
          ...[
            '../../ui/content/text',
            '../../ui/controls/action',
            '../../ui/controls/choice',
            '../../ui/controls/switch',
            '../../ui/layout/sheet',
            '../../ui/theme',
          ].map((path) => ({
            path,
            importer: root + 'apps/mobile/src/tasks/detail/',
            contents: native,
          })),
          {
            path: '../../runtime/connection/provider',
            importer: root + 'apps/mobile/src/tasks/detail/',
            contents: 'export const useRuntime=()=>window.store;',
          },
          {
            path: '../../shell/navigation',
            importer: noticeImporter,
            contents: 'export const useNavigation=()=>({navigate:(...args)=>window.opened=args});',
          },
          {
            path: '../../agents/permission-policy-controls',
            importer,
            contents: 'export const permissionPolicyUIIssue=()=>undefined;',
          },
          {
            path: '../../agents/use-harness-availability',
            importer,
            contents:
              'export const useHarnessAvailability=()=>({available:new Set(["harness:codex","harness:claude"]),error:null,loading:false});',
          },
          {
            path: '../../agents/harness-model-picker',
            importer,
            contents: `import {defaultTaskHarness} from './packages/protocol/src/index';export const HarnessModelPicker=({onChange})=><button onClick={()=>onChange('harness:claude',{...defaultTaskHarness('claude'),id:'claude',name:'Claude'})}>Choose Claude</button>;`,
          },
          {
            path: 'expo-crypto',
            contents: "export {randomUUID} from './packages/protocol/src/index';",
          },
        ]
      : [
          { path: '@dovo/studio-core', contents: shared },
          { path: '@dovo/studio-ui', contents: ui },
          {
            path: '../harness-fields',
            importer,
            contents: `import {defaultTaskHarness} from './packages/protocol/src/index';export const HarnessFields=({onChange})=><button onClick={()=>onChange(defaultTaskHarness('claude'))}>Choose Claude</button>;`,
          },
        ]
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {defaultTaskHarness} from './packages/protocol/src/index';
import {${mobile ? 'ContinueElsewhere' : 'ContinueElsewhereDialog'} as Continue} from './${dialogPath}';
import {MachineHandoffNotice} from './${noticePath}';
window.calls=[];window.fail=true;
const profile={id:'destination',name:'Desktop',connection:{runtimeId:'target'}};
const original={id:'thread',title:'Real thread',repositoryId:'repo',agentId:'',harness:defaultTaskHarness('codex'),providerLock:'codex',checkoutLocked:true,status:'running',createdAt:'',messages:[{id:'old',role:'user',text:'Saved request'}],files:[],draft:'',example:false};
function App(){const[task,setTask]=useState(original);const[mode,setMode]=useState('dialog');const[state,setState]=useState('failed');window.setTask=change=>setTask(current=>({...current,...change}));window.showNotice=()=>setMode('notice');window.setJobState=setState;
const request=async(path,input)=>{window.calls.push({path,input});if(path==='/api/tasks/continue-harness'){if(window.fail){setTask(current=>({...current,status:'review'}));throw new Error('Reply lost')}window.closed=true;return {ok:true}}if(path.endsWith('/retry')){setState('preparing');return {id:'transfer',state:'preparing'}}return {ok:true}};
const workspace={agents:[],repositories:[{id:'repo',name:'Project',path:'/project',branch:'main'}],tasks:[task]};
const job={id:'transfer',sourceTaskId:'thread',targetId:'target',targetName:'Desktop',targetTaskId:'continued',state,bytes:100,totalBytes:100,updatedAt:1};
window.store={connected:true,workspace,request,call:request,snapshot:{workspace,permissionPolicySupported:true,acpInstallations:[],defaults:{},projectTransfers:[job]},runtimes:[{profile}],overviews:[{profile}],switchRuntime:async id=>window.switched=id};
return mode==='dialog'?<Continue task={task} onMachine={()=>window.machine=true} onClose={()=>window.closed=true}/>:<MachineHandoffNotice taskId="thread" handoff={{id:'transfer',state:'moved',targetRuntimeId:'target',targetTaskId:'continued'}}/>}
createRoot(document.getElementById('app')).render(<App/>);`,
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        conditions: ['development'],
        define: { 'process.env.NODE_ENV': '"production"' },
        alias: {
          react: root + 'packages/studio-ui/node_modules/react',
          'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
        },
      },
      stubs,
    )
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 900, height: 900 } })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    await page.setContent('<body><div id="app"></div></body>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('button', { name: /Another harness on this computer/ }).click()
    await page.getByRole('button', { name: 'Choose Claude', exact: true }).click()
    const submit = page.getByRole('button', { name: 'Continue with Claude', exact: true })
    assert.equal(await submit.isDisabled(), true)
    await page.getByRole('checkbox', { name: /Stop the current turn first/ }).check()
    await submit.click()
    await page.getByRole('alert').filter({ hasText: 'Reply lost' }).waitFor()
    await page.evaluate(() => {
      window.fail = false
    })
    await submit.click()
    await page.waitForFunction(() => window.calls.length === 2)
    const calls = await page.evaluate(() => window.calls)
    assert.deepEqual(
      calls[0].input,
      calls[1].input,
      'A stopped turn must not change the payload of an uncertain retry',
    )
    assert.equal(calls[0].input.harness.provider, 'claude')
    assert.equal(calls[0].input.stop, true)
    await page.evaluate(() => window.showNotice())
    const retry = page.getByRole('button', { name: 'Retry move', exact: true })
    await retry.waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Open on Desktop', exact: true }).count(),
      0,
    )
    await retry.click()
    await page.waitForFunction(() => window.calls.some((call) => call.path.endsWith('/retry')))
    await page.evaluate(() => window.setJobState('completed'))
    await page.getByRole('button', { name: 'Open on Desktop', exact: true }).click()
    assert.deepEqual(
      await page.evaluate(() => window.opened),
      mobile ? ['tasks', 'continued', 'destination'] : { viewId: 'tasks', entityId: 'continued' },
    )
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} handoff: explicit stop, fresh harness, identical retry, pending activation and destination navigation pass.`,
    )
  }
} finally {
  await browser.close()
}
