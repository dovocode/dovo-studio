import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const mobile = fileURLToPath(new URL('../apps/mobile/', import.meta.url))
const mocks = {
  'react-native': `
import React from 'react';
const flat=s=>Object.assign({},...(Array.isArray(s)?s.flat(Infinity):[s]));
export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',boxSizing:'border-box',...flat(style)}}>{children}</div>;
export const ScrollView=({children,contentContainerStyle})=><div style={flat(contentContainerStyle)}>{children}</div>;
export const KeyboardAvoidingView=View;export const ActivityIndicator=()=>null;
export const Keyboard={dismiss:()=>document.activeElement?.blur()};export const Platform={OS:'ios'};
export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState,accessibilityValue,style})=><button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-valuetext={accessibilityValue?.text} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={onPress} style={flat(style)}>{children}</button>;
`,
  'react-native-reanimated': `import {View} from 'react-native';const transition={duration:()=>transition,reduceMotion:()=>transition};export const LinearTransition=transition,ReduceMotion={Always:'always',System:'system'};export default {View};`,
  'expo-crypto': `let n=0;export const randomUUID=()=> 'quick-'+(++n);`,
  'expo-router': `export const router={replace:value=>window.navigation.push(value),push:value=>window.navigation.push(value),canGoBack:()=>false,back:()=>{}};export const useLocalSearchParams=()=>({});`,
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;export const RuntimeScope=({children})=>children;`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  './folder-picker': `export const FolderPicker=()=>null;`,
  '../../ui/controls/icon-button': `export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../../ui/controls/action': `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../../ui/controls/field': `export const Field=({label,value,onChangeText,onFocus,onBlur,editable,placeholder,style})=><textarea aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)} onFocus={onFocus} onBlur={onBlur} disabled={!editable} placeholder={placeholder} style={{...style,height:style.minHeight,boxSizing:'border-box'}}/>;`,
  '../../ui/content/text': `export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;`,
  '../../ui/layout/screen-header': `export const ScreenHeader=()=>null;`,
  '../../ui/theme': `export const useTheme=()=>({colors:{text:'#fff',border:'#444',accent:'#fff',surface:'#222',muted:'#999'},styles:{screen:{},content:{},muted:{},error:{}},reduceMotion:false});`,
  '../../ui/layout/sheet': `export const Sheet=({title,onClose,children})=><div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>;`,
  '../../ui/controls/icon': `export const Icon=()=>null;`,
  '../../agents/harness-icon': `export const HarnessIcon=()=>null;`,
  '../../ui/controls/choice': `export const Choice=()=>null;`,
  '../../agents/permission-policy-controls': `export const PermissionPolicyControls=()=>null;`,
  '../../agents/harness-model-picker': `export const HarnessModelPicker=()=>null;`,
  '../../agents/model-settings': `export const ModelSettings=()=>null;`,
  '../../agents/use-harness-availability': `export const useHarnessAvailability=()=>({available:new Set(['codex']),loading:false,error:''});`,
}
const built = await build({
  stdin: {
    resolveDir: mobile,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {TaskLauncherScreen} from './src/tasks/creation/task-launcher-screen';import {defaultTaskHarness} from '@dovo/protocol';
const profile={id:'runtime',name:'Runtime'};const repository={id:'repo',name:'Project',path:'/repo',branch:'main'};
const snapshot={revision:0,owner:true,approvals:[],terminals:[],runs:[],devices:[],pendingDevices:[],workspace:{version:1,runtimeAddress:'',agents:[],repositories:[repository],tasks:[],automations:[]},defaults:{harness:defaultTaskHarness('codex'),execution:'main'}};
window.requests=[];window.navigation=[];window.failMessage=true;
window.runtime={ready:true,profiles:[profile],activeId:profile.id,readRuntime:async(_profile,path,input)=>{if(path==='/api/snapshot')return snapshot;window.requests.push({path,input});if(path==='/api/tasks/message'&&window.failMessage){window.failMessage=false;throw Error('Delivery failed')}return {revision:1,ok:true}},refreshRuntime:async()=>{}};
createRoot(document.getElementById('app')).render(<TaskLauncherScreen/>);
`,
  },
  plugins: [
    {
      name: 'native-adapters',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: mobile,
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  page.setDefaultTimeout(5000)
  const field = page.getByRole('textbox', { name: 'Task prompt' }),
    picker = page.getByRole('button', { name: 'Choose agent and model' })
  await field.waitFor()
  await page.getByRole('button', { name: 'Start task' }).waitFor()
  assert.equal(await field.getAttribute('placeholder'), 'Send a message…')
  assert.equal((await field.boundingBox()).height, 44)
  assert.equal(await picker.count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Start task' }).isDisabled(), true)
  await field.focus()
  await picker.waitFor()
  assert.equal((await field.boundingBox()).height, 64)
  await picker.click()
  const sheet = page.getByRole('dialog', { name: 'Agent & model' })
  await sheet.waitFor()
  await field.blur()
  assert.equal(await field.evaluate((node) => document.activeElement === node), false)
  assert.equal((await field.boundingBox()).height, 64)
  await sheet.getByRole('button', { name: 'Close' }).click()
  assert.equal((await field.boundingBox()).height, 44)
  await field.fill('Investigate this issue')
  assert.equal((await field.boundingBox()).height, 64)
  await field.blur()
  assert.equal((await field.boundingBox()).height, 64)
  await picker.waitFor()
  await page.getByRole('button', { name: 'Start task' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('alert').textContent(), 'Delivery failed')
  assert.equal(await field.inputValue(), 'Investigate this issue')
  assert.equal(await field.isDisabled(), true)
  await page.getByRole('button', { name: 'Retry dispatch' }).click()
  await page.waitForFunction(() => window.navigation.length === 1)
  const requests = await page.evaluate(() => window.requests)
  assert.deepEqual(
    requests.map((x) => x.path),
    ['/api/workspace', '/api/tasks/message', '/api/tasks/message'],
  )
  assert.equal(requests[0].input.id, requests[1].input.id)
  assert.equal(requests[1].input.id, requests[2].input.id)
  assert.equal(requests[1].input.messageId, requests[2].input.messageId)
  assert.equal(requests[1].input.text, 'Investigate this issue')
  assert.equal(requests[2].input.text, requests[1].input.text)
  assert.deepEqual(errors, [])
  console.log(
    'Quick task: compact, focus, model sheet, typing and retry identity passed (native adapters).',
  )
} finally {
  await browser.close()
}
