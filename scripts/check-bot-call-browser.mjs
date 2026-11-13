import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)),
  mobile = root + 'apps/mobile/src/'
const controls = `export const View=({children,...p})=><div>{children}</div>;export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;export const Button=({children,size,variant,...p})=><button {...p}>{children}</button>;export const BotAvatar=({name})=><img alt={name}/>;export const Dialog=({children})=><div role="dialog">{children}</div>;export const DialogContent=({children,...p})=><section {...p}>{children}</section>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;export const Sheet=({children,title})=><div role="dialog"><h2>{title}</h2>{children}</div>;`
const audio = `export function browserBotCallAudio(){return make()} export function mobileBotCallAudio(){return make()} function make(){return {listen:async(signal,events)=>{window.recordings.push({signal,events})},speak:(text,signal)=>new Promise(resolve=>window.spoken.push({text,signal,resolve}))}}`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{BotCall as Web}from'./packages/extension-tasks/src/bots/bot-call';import{BotCall as Mobile}from'./apps/mobile/src/bots/bot-call';window.recordings=[];window.spoken=[];window.sent=[];window.fail=false;window.callClosed=0;window.task={id:'bot',title:'Ada',messages:[],files:[],turns:[],bot:{state:'active',role:'Helper'}};window.store={connected:true,activeRuntimeId:'host',connection:{runtimeId:'host',address:'http://lan',token:'paired'},snapshot:{questions:[],approvals:[],queuePausePreservationSupported:true},request:async(path,input)=>{window.sent.push({path,input});if(window.fail){window.fail=false;throw Error('Response lost')}return {ok:true}}};window.runtime={...window.store,call:window.store.request,profile:{id:'host',connection:window.store.connection}};function App(){const[version,setVersion]=useState(0);window.refresh=()=>setVersion(v=>v+1);const[mobile,setMobile]=useState(false);window.mobile=setMobile;return mobile?<Mobile task={{...window.task}} onClose={()=>window.callClosed++}/>:<Web task={{...window.task}} onClose={()=>window.callClosed++}/>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      '@dovo/client-runtime': root + 'packages/client-runtime/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>window.store;export const useAppPreferences=()=>({runtimeDictationIds:['host'],dictationLanguage:'auto'});`,
    },
    {
      path: '@dovo/studio-core/runtime-dictation',
      contents: `export const useRuntimeDictationBridge=()=>window.bridge;`,
    },
    { path: '@dovo/studio-ui', contents: controls },
    {
      path: './bot-call-audio',
      importer: root + 'packages/extension-tasks/src/bots/',
      contents: audio,
    },
    { path: './bot-call-audio', importer: mobile + 'bots/', contents: audio },
    { path: 'expo-crypto', contents: "export {randomUUID} from '@dovo/protocol';" },
    {
      path: 'react-native',
      contents:
        controls +
        `export const AppState={addEventListener:(_,fn)=>{window.background=fn;return{remove(){}}}};`,
    },
    {
      path: '../runtime/connection/provider',
      importer: mobile + 'bots/',
      contents: `export const useRuntime=()=>window.runtime;`,
    },
    { path: '../ui/layout/sheet', importer: mobile + 'bots/', contents: controls },
    {
      path: '../ui/theme',
      importer: mobile + 'bots/',
      contents:
        'export const useTheme=()=>({styles:{text:{color:"#f5f5f5"},muted:{color:"#aaa"},error:{color:"#ffaaaa"}}});',
    },
    { path: '../ui/content/text', importer: mobile + 'bots/', contents: controls },
    { path: '../ui/controls/action', importer: mobile + 'bots/', contents: controls },
    { path: './bot-avatar', importer: mobile + 'bots/', contents: controls },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.setDefaultTimeout(10000)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const mobile of [false, true]) {
    if (mobile) await page.evaluate(() => window.mobile(true))
    await page.getByRole('button', { name: 'Start call', exact: true }).click()
    await page.waitForFunction(() => window.recordings.length > 0)
    await page.evaluate(() => {
      window.fail = true
      window.recordings.at(-1).events.finish('Check my release')
    })
    await page.getByRole('button', { name: 'Retry same message' }).click()
    await page.waitForFunction(() => window.sent.length === 2)
    const sent = await page.evaluate(() => window.sent)
    assert.deepEqual(sent[0], sent[1])
    assert.equal(sent[0].input.preserveQueuePause, true)
    await page.evaluate(() => {
      const id = window.sent[0].input.messageId
      window.task.messages = [
        { id, role: 'user', text: 'Check my release', turnId: 'turn' },
        { id: 'answer', role: 'assistant', text: 'The release passed.', turnId: 'turn' },
      ]
      window.task.turns = [{ id: 'turn', status: 'completed' }]
      window.refresh()
    })
    await page.getByRole('button', { name: 'Interrupt', exact: true }).click()
    assert.equal(await page.evaluate(() => window.spoken[0].signal.aborted), true)
    await page.getByRole('button', { name: 'Mute', exact: true }).click()
    assert.equal(await page.evaluate(() => window.recordings.at(-1).signal.aborted), true)
    await page.getByRole('button', { name: 'Unmute', exact: true }).click()
    await page.evaluate(() => {
      window.store.snapshot.questions = [{ taskId: 'bot' }]
      window.refresh()
    })
    await page.getByRole('button', { name: 'Review in chat', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.recordings.at(-1).signal.aborted), true)
    await page.getByRole('button', { name: 'End call', exact: true }).click()
    assert.equal(await page.evaluate(() => window.callClosed), mobile ? 2 : 1)
    await page.evaluate(() => {
      window.recordings = []
      window.spoken = []
      window.sent = []
      window.task.messages = []
      window.task.turns = []
      window.store.snapshot.questions = []
    })
  }
  assert.deepEqual(errors, [])
  console.log(
    'Bot calls: web/mobile screens, identical send retry, exact reply playback, Interrupt, Mute, human review and End pass. Audio and native controls are fixtures.',
  )
} finally {
  await browser.close()
}
