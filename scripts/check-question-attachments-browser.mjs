import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const native = `
export const View=({children})=><div>{children}</div>;export const ScrollView=View;
export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;
export const Keyboard={dismiss(){}};export const Linking={openSettings(){}};export const Platform={OS:'ios'};
export const Alert={alert:(title,text,buttons)=>{window.alerts.push(title);buttons?.find(button=>button.text==='Files')?.onPress?.()}};
export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Field=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={!editable} onChange={e=>onChangeText(e.target.value)}/>;
export const useTheme=()=>({styles:{},colors:{}});
`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const mocks = {
      '@dovo/studio-core': `export {useWorkspace} from '${root}packages/studio-core/src/workspace/context.ts';export {useQuestionRecovery} from '${root}packages/studio-core/src/workspace/question-recovery.ts';export {responses,attachmentUploadResultSchema,attachmentReadSchema,attachmentMutationSchema,MAX_ATTACHMENT_BYTES,MAX_ATTACHMENTS} from '@dovo/protocol';`,
      '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
      '@dovo/studio-ui': `export {QuestionForm} from '${root}packages/studio-ui/src/question-form.tsx';export {Button} from '${root}packages/studio-ui/src/components/ui/button.tsx';`,
      '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=effect=>Effect.runPromise(effect);`,
      '../composer/image-editor': `export const useImageEditor=()=>({edit:async file=>file,editor:null});`,
      './image-editor': `export const useImageEditor=()=>({edit:async file=>file,editor:null});`,
      './optimize-attachment-image': `export const optimizeAttachmentImage=async asset=>asset;`,
      '../../agents/secret-reference-fields': `export const SecretReferenceFields=()=>null;`,
      '@react-native-async-storage/async-storage': `const records=new Map();window.nativeRecoveryStorage=records;export default {getAllKeys:async()=>[...records.keys()],getItem:async key=>records.get(key)??null,setItem:async(key,value)=>{records.set(key,value)}};`,
      'react-native': native,
      '../../ui/content/text': native,
      '../../ui/controls/action': native,
      '../../ui/controls/field': native,
      '../../ui/theme': native,
      '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
      '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
      '../conversation/state/provider': `export const useConversationSelector=select=>select({visible:true});`,
      'expo-router': `export const router={setParams(){}};`,
      '../../notifications/answers': `export const notificationAnswerDraft=async()=>null;export const clearNotificationAnswerDraft=async()=>{};`,
      '../../notifications/viewport-view': `export const NotificationInputView=({children})=><div>{children}</div>;`,
      'expo-image-picker': `export const requestCameraPermissionsAsync=async()=>({granted:true});export const launchCameraAsync=async()=>({canceled:true});export const launchImageLibraryAsync=launchCameraAsync;`,
      'expo-document-picker': `export const getDocumentAsync=async()=>({canceled:false,assets:[{uri:'file://answer.txt',name:'answer.txt',mimeType:'text/plain'}]});`,
      'expo-clipboard': `export const getImageAsync=async()=>null;`,
      'expo-crypto': `let id=0;export const randomUUID=()=>"00000000-0000-4000-8000-"+String(++id).padStart(12,'0');`,
      'expo-file-system': `export const Paths={cache:'cache'};export class File{constructor(uri){this.uri=uri}get size(){return 3}base64(){return Promise.resolve('YWJj')}delete(){}}`,
    }
    const built = await build({
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';import {decode,questionPromptSchema} from '@dovo/protocol';
import {WorkspaceContext} from '${root}packages/studio-core/src/workspace/context.ts';
import {TaskQuestions} from '${root}${mobile ? 'apps/mobile/src/tasks/detail' : 'packages/extension-tasks/src/chat/thread'}/task-questions.tsx';
const prompt=decode(questionPromptSchema,{title:'Answer with references',questions:[{id:'design',header:'Design',question:'Attach design'},{id:'notes',header:'Notes',question:'Attach notes',required:false},{id:'secret',header:'Secret',question:'Private',secret:true,required:false},{id:'number',header:'Number',question:'Count',inputType:'number',required:false}]});
window.uploads=[];window.answers=[];window.acknowledged=[];window.alerts=[];window.fail=false;window.hold=false;
const task={id:'task',title:'Task',draft:'Untouched message',draftAttachments:[]};const pending={id:'question',taskId:'task',prompt,createdAt:'',attachments:true};
window.request=async(path,input)=>{if(path==='/api/tasks/answer'){window.answers.push(input);if(window.fail)throw Error('Answer admission failed');return {ok:true}}if(path==='/api/attachments/remove')return {ok:true,revision:1};window.uploads.push(input);if(window.hold)await new Promise(resolve=>window.release=resolve);return {attachment:{id:input.id,name:input.name,mime:'text/plain',size:3},revision:1}};
const read=(...args)=>Effect.tryPromise({try:()=>window.request(...args),catch:e=>e});
function App(){const[mount,setMount]=useState(0);window.remount=()=>setMount(value=>value+1);const[connected,setConnected]=useState(true);const[question,setQuestion]=useState(pending);window.setQuestion=mode=>setQuestion({...pending,id:mode,prompt:{...prompt,unanswered:mode!=='legacy',questions:prompt.questions.map(q=>({...q,required:false}))}});window.connect=setConnected;window.runtime={connected,connection:{address:'http://runtime.local',token:'original'},profile:{id:'computer',name:'Computer',connection:{address:'http://runtime.local',token:'original'}},workspace:{tasks:[task],repositories:[]},snapshot:{revision:1,questions:[question],workspace:{tasks:[task],repositories:[]}},request:window.request,callEffect:read,readRuntimeEffect:(_owner,...args)=>read(...args),requestAttachmentEffect:(_owner,input)=>read('/api/attachments/upload',input),finishAttachmentEffect:(_owner,id)=>Effect.sync(()=>window.acknowledged.push(id)),reviewAttachments:()=>{},discardAttachment:async()=>{},refreshRuntimeEffect:()=>Effect.void};return <WorkspaceContext.Provider value={window.runtime}><TaskQuestions key={mount} taskId="task"/><textarea data-task-id="task" aria-label="Normal message" defaultValue={task.draft}/></WorkspaceContext.Provider>};createRoot(document.getElementById('app')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      alias: {
        react: root + 'packages/studio-ui/node_modules/react',
        'react-dom/client': root + 'packages/studio-ui/node_modules/react-dom/client.js',
        'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
        '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      },
      nodePaths: [
        root + 'apps/mobile/node_modules',
        root + 'packages/studio-ui/node_modules',
        root + 'node_modules',
      ],
      plugins: [
        {
          name: 'boundaries',
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
            )
            b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: root + 'apps/mobile',
            }))
          },
        },
      ],
    })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(e.message)
      console.error(e.message)
    })
    page.setDefaultTimeout(10000)
    await page.route('http://questions.local/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
    )
    await page.goto('http://questions.local/')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const attach = page.getByRole('button', { name: 'Attach files to answer', exact: true })
    await attach.first().waitFor()
    assert.equal(await attach.count(), 2, 'Only ordinary custom text questions accept files')
    const upload = async (index) => {
      if (mobile) await attach.nth(index).click()
      else
        await page
          .getByLabel('Choose answer files')
          .nth(index)
          .setInputFiles({ name: 'answer.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
    }
    await page.evaluate(() => (window.hold = true))
    await upload(0)
    await page.waitForFunction(() => window.uploads.length === 1)
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].find(
          (button) => button.textContent === 'Send answers',
        )?.disabled,
    )
    assert.equal(
      await page.getByRole('button', { name: 'Send answers', exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.hold = false
      window.release()
    })
    await page.getByRole('button', { name: 'Remove answer.txt', exact: true }).waitFor()
    await upload(1)
    await page.waitForFunction(() => window.uploads.length === 2)
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label="Remove answer.txt"]').length === 2 ||
        [...document.querySelectorAll('button')].filter(
          (b) => b.textContent === 'Remove answer.txt',
        ).length === 2,
    )
    assert.equal(
      await page.getByRole('textbox', { name: 'Normal message', exact: true }).inputValue(),
      'Untouched message',
    )
    assert.ok(
      (await page.evaluate(() => window.uploads)).every(
        (input) => input.taskId === 'task' && input.detached === true && !input.queuedMessageId,
      ),
    )
    await page.waitForFunction(() => {
      const records = window.nativeRecoveryStorage
        ? [...window.nativeRecoveryStorage.values()]
        : Object.keys(localStorage)
            .filter((key) => key.startsWith('dovo.question-recovery.v2.'))
            .map((key) => localStorage.getItem(key))
      return records.some(
        (value) =>
          value.includes('answer.txt') && value.includes('design') && value.includes('notes'),
      )
    })
    await page.evaluate(() => window.remount())
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[aria-label="Remove answer.txt"]').length === 2 ||
        [...document.querySelectorAll('button')].filter(
          (button) => button.textContent === 'Remove answer.txt',
        ).length === 2,
    )
    await page.evaluate(() => (window.fail = true))
    await page.getByRole('button', { name: 'Send answers', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Answer admission failed' }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Remove answer.txt', exact: true }).count(),
      2,
      'Failed answer retains files',
    )
    await page.evaluate(() => (window.fail = false))
    await page.getByRole('button', { name: 'Send answers', exact: true }).click()
    await page.waitForFunction(() => window.answers.length === 2)
    const answers = await page.evaluate(() => window.answers)
    assert.deepEqual(answers[1], answers[0], 'Retries preserve per-question files')
    assert.equal(answers[1].attachmentIdsByQuestion.design.length, 1)
    assert.equal(answers[1].attachmentIdsByQuestion.notes.length, 1)
    assert.equal(
      answers[1].answers.design.length,
      0,
      'File-only response remains distinct from typed text',
    )
    if (mobile) await page.waitForFunction(() => window.acknowledged.length === 2)
    await page.evaluate(() => window.setQuestion('replied'))
    await page.getByRole('button', { name: 'I replied in chat', exact: true }).click()
    await page.waitForFunction(() => window.answers.at(-1)?.id === 'replied')
    const replied = await page.evaluate(() => window.answers.at(-1))
    assert.deepEqual(replied.answers, {})
    assert.deepEqual(
      replied.outcomes,
      Object.fromEntries(
        ['design', 'notes', 'secret', 'number'].map((id) => [id, 'replied_in_chat']),
      ),
    )
    assert.equal(
      replied.attachmentIdsByQuestion,
      undefined,
      'Reply-in-chat never reattaches old files',
    )
    await page.evaluate(() => window.setQuestion('skipped'))
    await page.getByRole('button', { name: 'Send answers', exact: true }).click()
    await page.waitForFunction(() => window.answers.at(-1)?.id === 'skipped')
    assert.ok(
      Object.values((await page.evaluate(() => window.answers.at(-1))).answers).every(
        (values) => values.length === 0,
      ),
    )
    await page.evaluate(() => window.setQuestion('dismissed'))
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await page.waitForFunction(() => window.answers.at(-1)?.id === 'dismissed')
    assert.equal((await page.evaluate(() => window.answers.at(-1))).answers, null)
    await page.evaluate(() => window.setQuestion('legacy'))
    await page.getByRole('button', { name: 'Decline', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'I replied in chat', exact: true }).count(),
      0,
    )
    assert.equal(
      await page.getByRole('textbox', { name: 'Normal message', exact: true }).inputValue(),
      'Untouched message',
    )
    if (!mobile) {
      await page.evaluate(() => window.setQuestion('empty-composer-enter'))
      const composer = page.getByRole('textbox', { name: 'Normal message', exact: true })
      const before = await page.evaluate(() => window.answers.length)
      await composer.focus()
      await page.evaluate(() => window.setQuestion('empty-composer-enter-new'))
      await page.getByRole('button', { name: 'Dismiss', exact: true }).waitFor()
      assert.equal(
        await composer.evaluate((element) => document.activeElement === element),
        true,
        'A new question preserves composer focus',
      )
      await composer.press('Enter')
      assert.equal(
        await page.evaluate(() => window.answers.length),
        before,
        'Typed composer text does not answer a question',
      )
      await composer.fill('')
      await composer.press('Enter')
      assert.equal(
        await page.evaluate(() => window.answers.length),
        before,
        'Empty composer does not answer a question',
      )
      assert.equal(
        await composer.inputValue(),
        '\n',
        'The composer keeps its normal Enter behavior',
      )
      await page.getByRole('region', { name: 'Questions', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => window.answers.at(-1)?.id === 'empty-composer-enter-new')
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Question files: desktop and mobile form adapters passed per-question ownership, detached uploads, upload gating, file-only answers, unchanged drafts, saved attachment references, form remount recovery, failed admission retention and identical retry checks.',
  )
} finally {
  await browser.close()
}
