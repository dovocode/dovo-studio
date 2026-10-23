import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = root + '/apps/mobile/src/runtime/connection'
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {RelaySettings as Desktop} from '${root}/packages/extension-runtime/src/relay-settings';
import {RelaySettings as Mobile} from '${mobile}/relay-settings';
const app=createRoot(document.getElementById('app'));window.round=0;window.kind='desktop';
window.scope=()=>({activeRuntimeId:window.target,profile:{id:window.target,name:window.target},runtimeRegistry:{profiles:[{id:window.target,name:window.target}]},snapshot:{relaySetupSupported:true,relaySettings:window.relayStatus},connected:window.connected,request:window.request,call:window.request,refreshRuntime:async()=>window.render(),refresh:async()=>window.render()});
window.request=async(path,input)=>{window.writes.push({path,input,target:window.target});if(window.fail)throw Error('Relay settings rejected');if(path==='/api/runtime/connection-mode'){window.relayStatus={...window.relayStatus,connectionMode:input.mode};return window.relayStatus}const connectionMode=window.relayStatus.connectionMode;window.relayStatus=input.config?{mode:'custom',configured:true,urls:input.config.urls}:{mode:'organization',configured:true,urls:[],organization:'Company'};window.relayStatus.connectionMode=connectionMode;return window.relayStatus};
window.render=()=>flushSync(()=>app.render(window.kind==='desktop'?<Desktop key={window.round}/>:<Mobile key={window.round}/>));
window.reset=kind=>{window.round++;window.kind=kind;window.target='Server B';window.connected=true;window.fail=false;window.relayStatus={mode:'organization',configured:true,urls:[],organization:'Company',connectionMode:'automatic'};window.writes=[];window.consent=null;window.render()};window.reset('desktop');
`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
  },
  [
    { path: '@dovo/studio-core', contents: 'export const useWorkspace=()=>window.scope();' },
    {
      path: '@dovo/studio-ui',
      contents:
        'export const ChoicePicker=({value,onValueChange,children,disabled,...props})=><select {...props} value={value} disabled={disabled} onChange={e=>onValueChange(e.target.value)}>{children}</select>;export const Button=({children,onClick,disabled})=><button onClick={onClick} disabled={disabled}>{children}</button>;export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;',
    },
    {
      path: './provider',
      importer: mobile,
      contents: 'export const useRuntime=()=>window.scope();',
    },
    {
      path: 'react-native',
      contents:
        "export const Pressable=({children,accessibilityLabel,accessibilityState,onPress})=><button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress}>{children}</button>;export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;export const Alert={alert:(title,message,buttons)=>{window.consent={title,message};window.confirmMobile=()=>buttons.find(button=>button.text==='Confirm relay settings').onPress()}};",
    },
    {
      path: '../../ui/controls/choice',
      importer: mobile,
      contents:
        'export const Choice=({value,onChange,items,label,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;',
    },
    { path: '../../ui/controls/icon', importer: mobile, contents: 'export const Icon=()=>null;' },
    {
      path: '../../ui/controls/field',
      importer: mobile,
      contents:
        "export const Field=({label,value,onChangeText,secureTextEntry,editable})=><label>{label}<input aria-label={label} value={value} type={secureTextEntry?'password':'text'} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/></label>;",
    },
    {
      path: '../../ui/controls/action',
      importer: mobile,
      contents:
        'export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;',
    },
    {
      path: '../../ui/content/text',
      importer: mobile,
      contents:
        'export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;',
    },
    {
      path: '../../ui/theme',
      importer: mobile,
      contents: 'export const useTheme=()=>({styles:{},colors:{}});',
    },
    {
      path: '../../ui/controls/use-action',
      importer: mobile,
      contents: `import {useState,useRef} from 'react';export const useAction=()=>{const [busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false);return {busy,error,act:work=>{if(pending.current)return;pending.current=true;setBusy(true);void work().catch(e=>setError(e.message)).finally(()=>{pending.current=false;setBusy(false)})}}};`,
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
  for (const kind of ['desktop', 'mobile']) {
    await page.evaluate((kind) => window.reset(kind), kind)
    await page.getByText(/Supplied by Company/).waitFor()
    const connectionMode = page.getByLabel('Connection mode', { exact: true })
    for (const mode of ['webrtc', 'lan', 'automatic']) {
      await connectionMode.selectOption(mode)
      await page.getByRole('button', { name: 'Apply connection mode', exact: true }).click()
      await page.waitForFunction((mode) => window.relayStatus.connectionMode === mode, mode)
    }
    await page.evaluate(() => (window.writes = []))
    assert.equal(await page.getByLabel('TURN URLs', { exact: true }).isVisible(), false)
    await page.getByText('Custom TURN server', { exact: true }).click()
    await page.getByLabel(/^TURN URLs/).fill('turn:relay.example.com')
    await page.getByLabel('TURN username', { exact: true }).fill('relay-user')
    await page.getByLabel('TURN password', { exact: true }).fill('private-password')
    assert.equal(
      await page.getByLabel('TURN password', { exact: true }).getAttribute('type'),
      'password',
    )
    await page.getByRole('button', { name: 'Use custom TURN', exact: true }).click()
    assert.equal(await page.evaluate(() => window.writes.length), 0)
    if (kind === 'desktop') {
      await page.getByText(/Use this TURN server for Server B/).waitFor()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('button', { name: 'Use custom TURN', exact: true }).click()
      await page.getByRole('button', { name: 'Confirm relay settings', exact: true }).click()
    } else {
      assert.match(await page.evaluate(() => window.consent.title), /Server B/)
      await page.evaluate(() => window.confirmMobile())
    }
    await page.getByText('Custom TURN server configured.', { exact: false }).waitFor()
    const writes = await page.evaluate(() => window.writes)
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0], {
      path: '/api/runtime/relay',
      target: 'Server B',
      input: {
        consent: true,
        config: {
          urls: ['turn:relay.example.com'],
          username: 'relay-user',
          credential: 'private-password',
        },
      },
    })
    assert.equal(await page.getByLabel('TURN password', { exact: true }).inputValue(), '')
    await page.getByRole('button', { name: 'Use automatic relay', exact: true }).click()
    if (kind === 'desktop')
      await page.getByRole('button', { name: 'Confirm relay settings', exact: true }).click()
    else await page.evaluate(() => window.confirmMobile())
    await page.getByText(/Supplied by Company/).waitFor()
    assert.equal((await page.evaluate(() => window.writes)).at(-1).input.config, null)
    await page.getByLabel('TURN password', { exact: true }).fill('draft-private-password')
    await page.evaluate(() => {
      window.target = 'Server C'
      window.render()
    })
    assert.equal(await page.getByLabel('TURN URLs', { exact: true }).isVisible(), false)
    await page.getByText('Custom TURN server', { exact: true }).click()
    assert.equal(await page.getByLabel('TURN password', { exact: true }).inputValue(), '')
    await page.evaluate(() => {
      window.connected = false
      window.render()
    })
    assert.equal(
      await page.getByRole('button', { name: 'Use custom TURN', exact: true }).isDisabled(),
      true,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Desktop/mobile custom TURN: paired target, explicit confirmation, secret handling, policy override/reset, target changes and offline controls passed.',
  )
} finally {
  await browser.close()
}
