import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const native = `
export const View=({children})=><div>{children}</div>;export const ScrollView=View;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Keyboard={dismiss(){}};export const Linking={openSettings(){}};export const Platform={OS:'ios'};export const Alert={alert(){}};
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Field=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/>;
export const SettingsField=Field;export const SettingsChoice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
export const useTheme=()=>({styles:{},colors:{}});
`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const mocks = {
      '@dovo/studio-core': `export * from '@dovo/protocol';export const useWorkspace=()=>window.runtime;`,
      '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
      '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=effect=>Effect.runPromise(effect);`,
      'react-native': native,
      '../../ui/content/text': native,
      '../../ui/controls/action': native,
      '../../ui/theme': native,
      '../screens/settings-controls': native,
      '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
      '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
      '../../notifications/answers': `export const notificationAnswerDraft=async()=>null;export const clearNotificationAnswerDraft=async()=>{};`,
      '../../notifications/viewport-view': `export const NotificationInputView=({children})=><div>{children}</div>;`,
      './question-field': mobile
        ? `export const QuestionField=({question,draft,onChange,disabled})=><label>{question.question}{question.custom&&<input aria-label={'Answer: '+question.header} value={draft.text} disabled={disabled} onChange={event=>onChange({selected:[],text:event.target.value})}/>}</label>;`
        : `export {QuestionField} from '${root}packages/studio-ui/src/question-field.tsx';`,
      './image-editor': `export const useImageEditor=()=>({edit:async file=>file,editor:null});`,
      './attachment-images': `export const optimizeAttachmentImage=async file=>file;`,
      './optimize-attachment-image': `export const optimizeAttachmentImage=async asset=>asset;`,
      'expo-image-picker': `export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=async()=>({canceled:true});export const launchImageLibraryAsync=launchCameraAsync;`,
      'expo-document-picker': `export const getDocumentAsync=async()=>({canceled:true});`,
      'expo-clipboard': `export const getImageAsync=async()=>null;`,
      'expo-crypto': `let id=0;export const randomUUID=()=>"00000000-0000-4000-8000-"+String(++id).padStart(12,'0');`,
      'expo-file-system': `const files=new Map([['file://note.txt','hello']]);export const Paths={cache:'cache'};export class File{constructor(...parts){this.uri=parts.join('/')}get exists(){return files.has(this.uri)}get size(){return (files.get(this.uri)??'').length}async base64(){return btoa(files.get(this.uri)??'')}write(data){files.set(this.uri,atob(data))}delete(){files.delete(this.uri)}}`,
    }
    const built = await build({
      stdin: {
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
import {decode,questionPromptSchema} from '@dovo/protocol';
import {${mobile ? 'useAttachmentPicker as useFiles' : 'useAttachments as useFiles'}} from '${root}${mobile ? 'apps/mobile/src/tasks/composer/attachment-picker.tsx' : 'packages/extension-tasks/src/chat/composer/use-attachments.ts'}';
import {QuestionForm} from '${root}${mobile ? 'apps/mobile/src/tasks/composer/question-form.tsx' : 'packages/studio-ui/src/question-form.tsx'}';
import {useNextPrompt} from '${root}packages/studio-core/src/use-next-prompt.ts';
import {runtimeDictationBridge} from '${root}packages/studio-core/src/runtime-dictation.ts';
window.uploadCalls=[];window.sent=[];window.answers=[];window.fail=false;window.suggestionCalls=0;window.dictationCalls=[];
const initial={id:'task',title:'Task',status:'review',draft:'Keep this draft',draftAttachments:[],messages:[{id:'user',role:'user',text:'Build an app'}],turns:[{id:'turn',status:'completed'}]};
const request=async(path,input)=>{
 if(path==='/api/tasks/prompt-suggestion'){window.suggestionCalls++;return new Promise(resolve=>window.finishSuggestion=text=>resolve({turnId:'turn',text}))}
 if(path==='/api/dictation/status'){if(window.holdStatus)await new Promise(resolve=>window.finishStatus=resolve);return {engine:true,model:true,downloading:false,downloaded:0}}
 if(path==='/api/dictation/transcribe'){window.dictationCalls.push(input);return {text:'Runtime transcript'}}
 if(path==='/api/dictation/cancel'){window.dictationCalls.push(input);return {ok:true}}
 if(path==='/api/attachments/draft-guard')return {guard:'guard',guardedUploads:1};
 if(path==='/api/attachments/commit-upload')return {nextGuard:'guard',revision:2,attachment:window.lastAttachment};
 if(path==='/api/attachments/upload'){
   window.uploadCalls.push(input);await new Promise(resolve=>window.finishUpload=resolve);
   if(window.fail)throw Error('Upload failed');
   const attachment={id:input.id,name:input.name,mime:'text/plain',size:5};window.lastAttachment=attachment;
   window.publish(attachment);return {attachment,revision:2,nextGuard:'guard'};
 }
 throw Error(path)
};
const read=(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error});
function App(){
 const [task,setTask]=useState(initial),[text,setText]=useState(''),[enabled,setEnabled]=useState(false),[scope,setScope]=useState('computer-one'),[pending,setPending]=useState(false),[error,setError]=useState('');
 window.publish=file=>setTask(task=>({...task,draftAttachments:[...task.draftAttachments.filter(old=>old.id!==file.id),file]}));window.enableSuggestions=setEnabled;window.setScope=setScope;
 window.runtime={connected:true,request,snapshot:{revision:2,workspace:{tasks:[task]}},profile:{id:'computer',connection:{address:'http://computer.lan',token:'device'}},reviewAttachments(){},readRuntimeEffect:(_owner,...args)=>read(...args),refreshRuntimeEffect:()=>Effect.void,finishAttachmentEffect:()=>Effect.void,requestAttachmentEffect:(_owner,input)=>read('/api/attachments/upload',input)};
 const files=useFiles(${mobile ? 'task.id' : 'task'});window.files=files;
 const suggestion=useNextPrompt({task,enabled:enabled&&!text,scope,request});
 const prompt=decode(questionPromptSchema,{title:'Private credential',questions:[{id:'secret',header:'API key',question:'Provide the API key',secret:true}]});
 const submit=async()=>{setPending(true);setError('');const ids=[...new Set([...task.draftAttachments,...files.submissionFiles].map(file=>file.id))];try{await files.waitForUploads();window.sent.push(ids)}catch(cause){setError(String(cause))}finally{setPending(false)}};
 window.upload=()=>files.upload(${mobile ? "[{uri:'file://note.txt',name:'note.txt',mimeType:'text/plain'}]" : "[new File(['hello'],'note.txt',{type:'text/plain'})]"});
 return <><textarea aria-label="Message" value={text} onChange={event=>setText(event.target.value)}/><button onClick={submit} disabled={pending||files.failedUploads.length>0||(files.busy&&!files.canSubmitWhileUploading)}>Send upload</button><p role="status">{pending?'Waiting for uploads':error}</p>{files.failedUploads.map(file=><div key={file.id}><button onClick={()=>files.retryUpload(file.id)}>Retry file</button><button onClick={()=>files.discardFailedUpload(file.id)}>Remove file</button></div>)}<p aria-label="Suggestion">{suggestion.text}</p><button onClick={suggestion.dismiss}>Dismiss suggestion</button><QuestionForm request={{id:'question',taskId:'task',prompt,createdAt:'',secretReferences:true}} connected={true} notificationAccessible={false} onAnswer={async(answers,outcomes,references)=>{window.answers.push({answers,outcomes,references});throw Error('Keep pending for retry')}}/></>;
}
window.bridge=runtimeDictationBridge(request,'task');createRoot(document.getElementById('app')).render(<App/>);`,
        resolveDir: root,
        loader: 'tsx',
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
      nodePaths: [root + 'packages/studio-ui/node_modules', root + 'apps/mobile/node_modules'],
      plugins: [
        {
          name: 'boundaries',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'boundary' } : undefined,
            )
            builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: root,
            }))
          },
        },
      ],
    })
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => !!window.files)
    await page.evaluate(() => void window.upload())
    await page
      .waitForFunction(() => window.files.canSubmitWhileUploading)
      .catch(async (error) => {
        console.error(
          await page.evaluate(() => ({
            error: window.files.error,
            busy: window.files.busy,
            pending: window.files.submissionFiles,
            calls: window.uploadCalls,
          })),
        )
        throw error
      })
    await page.getByRole('button', { name: 'Send upload', exact: true }).click()
    assert.equal(await page.getByRole('status').textContent(), 'Waiting for uploads')
    assert.deepEqual(await page.evaluate(() => window.sent), [])
    await page.evaluate(() => window.finishUpload())
    await page.waitForFunction(() => window.sent.length === 1)
    assert.equal((await page.evaluate(() => window.sent[0])).length, 1)
    await page.waitForFunction(() => !window.files.busy)
    await page.evaluate(() => {
      window.fail = true
      void window.upload()
    })
    await page.waitForFunction(() => window.uploadCalls.length === 2)
    await page.evaluate(() => window.finishUpload())
    await page.getByRole('button', { name: 'Retry file', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Send upload', exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => (window.fail = false))
    await page.getByRole('button', { name: 'Retry file', exact: true }).click()
    await page.waitForFunction(() => window.uploadCalls.length === 3)
    const ids = await page.evaluate(() => window.uploadCalls.map((call) => call.id))
    assert.equal(ids[1], ids[2], 'Retry must reuse its upload identity')
    await page.evaluate(() => window.finishUpload())
    await page.waitForFunction(() => !window.files.busy && !window.files.failedUploads.length)
    await page.evaluate(() => window.enableSuggestions(true))
    await page.waitForFunction(() => window.suggestionCalls === 1)
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('My typed draft')
    await page.evaluate(() => window.finishSuggestion('Add tests'))
    assert.equal(await page.getByLabel('Suggestion', { exact: true }).textContent(), '')
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('')
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Suggestion"]').textContent === 'Add tests',
    )
    assert.equal(await page.evaluate(() => window.suggestionCalls), 1)
    await page.getByRole('button', { name: 'Dismiss suggestion', exact: true }).click()
    assert.equal(await page.getByLabel('Suggestion', { exact: true }).textContent(), '')
    await page.getByRole('button', { name: 'Use a secret reference', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Secret reference', exact: true })
      .fill('op://work/api/key')
    await page.getByRole('button', { name: 'Send answers', exact: true }).click()
    await page.waitForFunction(() => window.answers.length === 1)
    assert.deepEqual(await page.evaluate(() => window.answers[0].references), {
      secret: { provider: 'onepassword', reference: 'op://work/api/key' },
    })
    assert.deepEqual(await page.evaluate(() => window.answers[0].answers), { secret: [] })
    await page.getByRole('button', { name: 'Send answers', exact: true }).click()
    await page.waitForFunction(() => window.answers.length === 2)
    assert.deepEqual(
      await page.evaluate(() => window.answers[1]),
      await page.evaluate(() => window.answers[0]),
    )
    await page.evaluate(async () => {
      await window.bridge.start('recording', 'auto')
      await window.bridge.feed('recording', new Uint8Array([0, 1, 2, 3]).buffer)
      window.transcript = await window.bridge.finish('recording')
    })
    assert.equal(await page.evaluate(() => window.transcript), 'Runtime transcript')
    assert.deepEqual(await page.evaluate(() => window.dictationCalls[0]), {
      id: 'recording',
      taskId: 'task',
      language: 'auto',
      format: 'pcm',
      data: 'AAECAw==',
    })
    await page.evaluate(async () => {
      window.holdStatus = true
      const start = window.bridge.start('cancelled', 'auto').catch((error) => error.message)
      await new Promise((resolve) => setTimeout(resolve, 0))
      await window.bridge.cancel('cancelled')
      window.finishStatus()
      window.cancelled = await start
    })
    assert.match(await page.evaluate(() => window.cancelled), /cancelled/)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile (native boundaries mocked)' : 'Desktop/web'}: upload admission, stable retries, suggestions, vault reference answers and runtime dictation transport passed.`,
    )
  }
} finally {
  await browser.close()
}
