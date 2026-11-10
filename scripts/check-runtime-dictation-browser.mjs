import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  'react-native': `export const Platform={get OS(){return window.platform??'ios'}};export const AppState={addEventListener:(_event,listener)=>{window.background=()=>listener('background');return {remove(){}}}};`,
  expo: `export const requireOptionalNativeModule=()=>window.nativeModule===false?null:{};`,
  'expo-crypto': `let id=0;export const randomUUID=()=>String(++id);`,
  'expo-file-system': `export class File{constructor(uri){this.uri=uri}get size(){return 4}get exists(){return true}async base64(){return 'AAECAw=='}delete(){window.deleted.push(this.uri)}}`,
  'expo-audio': `export const RecordingPresets={HIGH_QUALITY:{ios:{},android:{}}};export const IOSOutputFormat={LINEARPCM:'lpcm'};export const requestRecordingPermissionsAsync=async()=>{window.permissions++;return {granted:window.permission!==false}};export const setAudioModeAsync=async mode=>window.modes.push(mode);export const AudioModule={AudioRecorder:class{constructor(options){window.options=options;this.uri='file://recording.wav'}async prepareToRecordAsync(){if(window.holdPrepare)await new Promise(resolve=>window.finishPrepare=resolve)}record(){window.recorded++}async stop(){window.stopped++}release(){window.released++}}};`,
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../../runtime/preferences/app-preferences': `export const useMobilePreferences=()=>window.preferences;`,
}
const built = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {useRuntimeDictation} from './apps/mobile/src/tasks/composer/use-runtime-dictation';
window.permissions=0;window.modes=[];window.deleted=[];window.requests=[];window.finished=[];window.recorded=0;window.released=0;window.stopped=0;
const call=async(path,input)=>{window.requests.push({path,input});return path.endsWith('/status')?{engine:true,model:true,downloading:false,downloaded:0}:path.endsWith('/transcribe')?(window.holdTranscribe?await new Promise(resolve=>window.finishTranscribe=()=>resolve({text:'Late transcript'})):{text:'Transcribed on runtime'}):{ok:true}};
function App(){const[state,setState]=useState({opted:false,taskId:'task-one',runtimeId:'computer-one'});window.setState=patch=>setState(state=>({...state,...patch}));window.preferences={runtimeDictationIds:state.opted?[state.runtimeId]:[],dictationLanguage:'nl-NL'};window.runtime={call,connected:true,profile:{id:state.runtimeId,connection:{runtimeId:state.runtimeId,address:'http://computer.lan',token:'device'}},snapshot:{runtimeId:state.runtimeId,runtimeDictationSupported:true}};const dictation=useRuntimeDictation(state.taskId,{onResult(){},onFinish:text=>window.finished.push(text)});window.dictation=dictation;return <p>{dictation.error}</p>};createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
  },
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'native-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'native' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'native' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate(() => window.dictation.start())
  assert.equal(await page.evaluate(() => window.permissions), 0)
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  await page.evaluate(() => window.setState({ opted: true }))
  await page.waitForFunction(() => window.dictation.selected)
  await page.evaluate(() => window.dictation.start())
  await page.waitForFunction(() => window.dictation.isRecording)
  await page.evaluate(() => window.dictation.stop())
  assert.deepEqual(await page.evaluate(() => window.finished), ['Transcribed on runtime'])
  assert.deepEqual(
    await page.evaluate(
      () => window.requests.find((request) => request.path.endsWith('/transcribe')).input,
    ),
    { id: '2', taskId: 'task-one', language: 'nl-NL', format: 'encoded', data: 'AAECAw==' },
  )
  assert.equal(await page.evaluate(() => window.options.outputFormat), 'lpcm')
  assert.equal(await page.evaluate(() => window.options.extension), '.wav')
  assert.equal(await page.evaluate(() => window.options.sampleRate), 16000)
  assert.equal(await page.evaluate(() => window.options.numberOfChannels), 1)
  assert.equal(await page.evaluate(() => window.released), 1)
  assert.equal(await page.evaluate(() => window.deleted.length), 1)
  await page.evaluate(() => {
    window.platform = 'android'
  })
  await page.evaluate(() => window.dictation.start())
  assert.equal(await page.evaluate(() => window.options.outputFormat), 'aac_adts')
  assert.equal(await page.evaluate(() => window.options.extension), '.aac')
  await page.evaluate(() => window.background())
  await page.waitForFunction(() => !window.dictation.isStopping)
  assert.equal(await page.evaluate(() => window.released), 2)
  assert.equal(await page.evaluate(() => window.finished.length), 1)
  await page.evaluate(() => {
    window.holdPrepare = true
    void window.dictation.start()
  })
  await page.waitForFunction(() => !!window.finishPrepare)
  await page.evaluate(() => window.setState({ taskId: 'task-two', runtimeId: 'computer-two' }))
  await page.evaluate(() => window.finishPrepare())
  await page.waitForFunction(() => window.released === 3)
  assert.equal(
    await page.evaluate(() => window.recorded),
    2,
    'Thread changes must cancel a recording still being prepared',
  )
  assert.equal(await page.evaluate(() => window.finished.length), 1)
  await page.waitForFunction(() => !window.dictation.isStopping)
  await page.evaluate(() => {
    window.holdPrepare = false
    window.holdTranscribe = true
  })
  await page.evaluate(() => window.dictation.start())
  await page.waitForFunction(() => window.dictation.isRecording)
  await page.evaluate(() => {
    void window.dictation.stop()
  })
  await page.waitForFunction(() => typeof window.finishTranscribe === 'function')
  await page.evaluate(() => window.setState({ taskId: 'task-three', runtimeId: 'computer-three' }))
  await page.waitForFunction(() => window.released === 4)
  await page.evaluate(() => window.finishTranscribe())
  await page.waitForFunction(() => !window.dictation.isStopping)
  assert.equal(
    await page.evaluate(() => window.finished.length),
    1,
    'A late transcript must not enter a different thread',
  )
  assert.equal(await page.evaluate(() => window.modes.at(-1).allowsRecording), false)
  assert.deepEqual(errors, [])
  console.log(
    'Phone runtime dictation (native boundaries mocked): device opt-in, WAV/ADTS capture, runtime delivery, background cancellation, cleanup and thread changes passed.',
  )
} finally {
  await browser.close()
}
