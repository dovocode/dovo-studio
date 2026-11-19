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
}
const built = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {useRuntimeDictation} from './apps/mobile/src/tasks/composer/use-runtime-dictation';
window.permissions=0;window.modes=[];window.deleted=[];window.requests=[];window.finished=[];window.recorded=0;window.released=0;window.stopped=0;
const call=async(runtimeId,path,input)=>{window.requests.push({runtimeId,path,input});return path.endsWith('/status')?{engine:true,model:true,downloading:false,downloaded:0}:path.endsWith('/transcribe')?(window.holdTranscribe?await new Promise(resolve=>window.finishTranscribe=()=>resolve({text:'Late transcript'})):{text:'Transcribed on runtime'}):{ok:true}};
function App(){
  const [state,setState]=useState({ready:false,taskId:'task-one',runtimeId:'computer-one'});
  window.setState=patch=>setState(current=>({...current,...patch}));
  const dictation=useRuntimeDictation();
  window.dictation=dictation;
  window.input=state;
  window.startDictation=()=>dictation.start(
    {taskId:state.taskId,ready:state.ready,language:'nl-NL',call:call.bind(null,state.runtimeId)},
    {onResult(){},onFinish:text=>window.finished.push({taskId:state.taskId,text})},
  );
  return <p>{dictation.error}</p>;
}
createRoot(document.getElementById('app')).render(<App/>);`,
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
  await page.evaluate(() => window.startDictation())
  assert.equal(await page.evaluate(() => window.permissions), 0)
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  await page.evaluate(() => window.setState({ ready: true }))
  await page.waitForFunction(() => window.input.ready)
  await page.evaluate(() => window.startDictation())
  await page.waitForFunction(() => window.dictation.isRecording)
  await page.evaluate(() => window.dictation.stop())
  assert.deepEqual(await page.evaluate(() => window.finished), [
    { taskId: 'task-one', text: 'Transcribed on runtime' },
  ])
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
  await page.evaluate(() => window.startDictation())
  assert.equal(await page.evaluate(() => window.options.outputFormat), 'aac_adts')
  assert.equal(await page.evaluate(() => window.options.extension), '.aac')
  await page.evaluate(() => window.background())
  await page.waitForFunction(() => !window.dictation.isStopping)
  assert.equal(await page.evaluate(() => window.released), 2)
  assert.equal(await page.evaluate(() => window.finished.length), 1)
  await page.evaluate(() => {
    window.holdPrepare = true
    void window.startDictation()
  })
  await page.waitForFunction(() => !!window.finishPrepare)
  const cancellations = await page.evaluate(
    () => window.requests.filter((request) => request.path.endsWith('/cancel')).length,
  )
  await page.evaluate(() => window.background())
  await page.waitForFunction(
    (before) =>
      window.requests.filter((request) => request.path.endsWith('/cancel')).length > before,
    cancellations,
  )
  await page.evaluate(() => window.finishPrepare())
  await page.waitForFunction(() => window.released === 3)
  assert.equal(
    await page.evaluate(() => window.recorded),
    2,
    'Going to the background must cancel a recording still being prepared',
  )
  assert.equal(await page.evaluate(() => window.finished.length), 1)
  await page.waitForFunction(() => !window.dictation.isStopping)
  await page.evaluate(() => {
    window.holdPrepare = false
    window.holdTranscribe = true
  })
  await page.evaluate(() => window.startDictation())
  await page.waitForFunction(() => window.dictation.isRecording)
  await page.evaluate(() => {
    void window.dictation.stop()
  })
  await page.waitForFunction(() => typeof window.finishTranscribe === 'function')
  await page.evaluate(() => window.setState({ taskId: 'task-two', runtimeId: 'computer-two' }))
  await page.waitForFunction(() => window.input.taskId === 'task-two')
  await page.evaluate(() => window.finishTranscribe())
  await page.waitForFunction(() => !window.dictation.isStopping)
  assert.deepEqual(await page.evaluate(() => window.finished.at(-1)), {
    taskId: 'task-one',
    text: 'Late transcript',
  })
  assert.equal(await page.evaluate(() => window.requests.at(-1).runtimeId), 'computer-one')
  assert.equal(await page.evaluate(() => window.released), 4)
  await page.evaluate(() => {
    window.holdTranscribe = false
  })
  await page.evaluate(() => window.startDictation())
  await page.waitForFunction(() => window.dictation.isRecording)
  await page.evaluate(() => window.dictation.stop())
  assert.deepEqual(await page.evaluate(() => window.finished.at(-1)), {
    taskId: 'task-two',
    text: 'Transcribed on runtime',
  })
  assert.equal(await page.evaluate(() => window.requests.at(-1).runtimeId), 'computer-two')
  assert.equal(await page.evaluate(() => window.modes.at(-1).allowsRecording), false)
  assert.deepEqual(errors, [])
  console.log(
    'Phone runtime dictation (native boundaries mocked): connection gate, WAV/ADTS capture, background cancellation, cleanup and transcript delivery to the originating thread passed.',
  )
} finally {
  await browser.close()
}
