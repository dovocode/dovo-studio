import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
const native = `
export const View=({children})=><div>{children}</div>;
export const ScrollView=View;
export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const TextInput=({accessibilityLabel,value,onChangeText})=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/>;
export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;
export const SafeModal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;
export const Icon=()=>null;
export const useTheme=()=>({colors:{}});
`
const browser = await chromium.launch()
try {
  await checkCommittedUploadCancellation(browser)
  for (const platform of ['desktop', 'mobile']) {
    const picker =
      root +
      (platform === 'desktop'
        ? 'packages/extension-tasks/src/chat/composer/thread-context-picker.tsx'
        : 'apps/mobile/src/tasks/composer/thread-context-picker.tsx')
    const mocks = [
      {
        path: '@dovo/protocol',
        contents: `export {threadContextSnapshot,conversationPageSchema} from '${root}packages/protocol/src/conversation/history.ts';export const notificationTestTaskId='dovo-notification-test';export const createRuntimeClient=connection=>({request:async(path,input,schema,{signal})=>{window.reads.push({owner:connection.address,before:input.before});if(window.hold)await new Promise(resolve=>window.release=resolve);if(signal.aborted)throw Error('aborted');if(window.fail)throw Error('History failed');return input.before?{messages:[{id:'old',role:'user',text:'Old message'}],turns:[],historyRevision:1}:{messages:[{id:'new',role:'assistant',text:'New message'}],turns:[],before:'old',historyRevision:1}}});`,
      },
      ...(platform === 'mobile'
        ? [
            {
              path: '../../runtime/connection/provider',
              importer: mobile,
              contents: `export const useRuntime=()=>window.context;`,
            },
            { path: 'react-native', contents: native },
            {
              path: './target',
              importer: mobile + 'src/notifications/',
              contents: `export const notificationTarget=data=>data;`,
            },
            ...[
              '../../ui/layout/safe-modal',
              '../../ui/content/text',
              '../../ui/controls/icon',
              '../../ui/theme',
            ].map((path) => ({ path, importer: mobile, contents: native })),
            { path: 'expo-crypto', contents: `export const randomUUID=()=>crypto.randomUUID();` },
            {
              path: 'expo-file-system',
              contents: `export const Paths={cache:'cache'};export class File{constructor(...args){this.uri=args.join('/');this.exists=true}write(text){window.fileText=text}delete(){this.exists=false}}`,
            },
          ]
        : [
            {
              path: '@dovo/studio-core',
              contents: `export const useWorkspace=()=>window.context;`,
            },
            {
              path: '@dovo/studio-ui',
              contents: `export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Dialog=({children,open})=>open?<div role="dialog">{children}</div>:null;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`,
            },
          ]),
    ]
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root + 'packages/extension-tasks',
          loader: 'tsx',
          contents: `
import {useState} from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';import {ThreadContextPicker} from '${picker}';
${platform === 'mobile' ? `import {registerAccessibleNotificationInput,shouldAlertForNotification} from '${mobile}src/notifications/visibility.ts';const input={runtimeId:'computer-a',taskId:'target',inputId:'question',inputType:'question'};registerAccessibleNotificationInput(input);window.modalAlert=()=>shouldAlertForNotification({...input,kind:'input'},true);` : ''}
window.reads=[];window.uploads=[];window.hold=false;window.fail=false;
function App(){const [owner,setOwner]=useState('computer-a'),[disabled,setDisabled]=useState(false),[mounted,setMounted]=useState(true);window.mount=value=>flushSync(()=>setMounted(value));window.changeOwner=value=>flushSync(()=>setOwner(value));window.disable=value=>flushSync(()=>setDisabled(value));const connection={address:owner};window.context={workspace:{tasks:[{id:'target',title:'Target'},{id:'source',title:'Source'}]},snapshot:{workspace:{tasks:[{id:'target',title:'Target'},{id:'source',title:'Source'}]}},connection,profile:{connection},activeId:owner,connected:true};return <><textarea aria-label="Draft" defaultValue="Keep this draft"/>{mounted&&<ThreadContextPicker taskId="target" disabled={disabled} upload={async(files,signal)=>{if(window.uploadHold)await new Promise(resolve=>window.releaseUpload=resolve);if(signal.aborted)throw Error('aborted');if(window.uploadFail)throw Error('Upload failed');window.uploads.push({owner, text:${platform === 'desktop' ? 'await files[0].text()' : 'window.fileText'}})}}/>}</>};createRoot(document.getElementById('app')).render(<App/>);
`,
        },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        conditions: ['development'],
        alias: { react: root + 'packages/studio-ui/node_modules/react' },
        nodePaths: [root + 'packages/studio-ui/node_modules', root + 'node_modules'],
      },
      mocks,
    )
    const page = await browser.newPage()
    await page.route('http://localhost:8350/**', (route) =>
      route.fulfill({ body: '<div id="app"></div>', contentType: 'text/html' }),
    )
    await page.goto('http://localhost:8350/')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const open = async () => {
      await page.getByRole('button', { name: 'Attach thread context' }).click()
      await page.getByRole('button', { name: 'Source' }).waitFor()
    }
    if (platform === 'mobile') assert.equal(await page.evaluate(() => window.modalAlert()), false)
    await open()
    if (platform === 'mobile') assert.equal(await page.evaluate(() => window.modalAlert()), true)
    assert.equal(await page.getByRole('button', { name: 'Target' }).count(), 0)
    await page.getByRole('button', { name: 'Source' }).click()
    await page.waitForFunction(() => window.uploads.length === 1)
    if (platform === 'mobile') await page.waitForFunction(() => !window.modalAlert())
    const [upload] = await page.evaluate(() => window.uploads)
    assert.equal(upload.owner, 'computer-a')
    assert.match(upload.text, /Old message[\s\S]*New message/)
    assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Keep this draft')
    await open()
    await page.evaluate(() => {
      window.fail = true
    })
    await page.getByRole('button', { name: 'Source' }).click()
    await page.getByRole('alert').filter({ hasText: 'History failed' }).waitFor()
    await page.evaluate(() => {
      window.fail = false
      window.uploadFail = true
    })
    await page.getByRole('button', { name: 'Source' }).click()
    await page.getByRole('alert').filter({ hasText: 'Upload failed' }).waitFor()
    await page.evaluate(() => {
      window.uploadFail = false
      window.hold = true
    })
    await page.getByRole('button', { name: 'Source' }).click()
    await page.waitForFunction(() => !!window.release)
    await page.evaluate(() => {
      window.changeOwner('computer-b')
      window.release()
    })
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].find((button) => button.textContent === 'Source')
          ?.disabled === false,
    )
    assert.equal(await page.evaluate(() => window.uploads.length), 1)
    await page.evaluate(() => {
      window.hold = false
      window.uploadHold = true
    })
    await page.getByRole('button', { name: 'Source' }).click()
    await page.waitForFunction(() => !!window.releaseUpload)
    await page.evaluate(() => {
      window.disable(true)
      window.releaseUpload()
    })
    await page.evaluate(() => window.disable(false))
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].find((button) => button.textContent === 'Source')
          ?.disabled === false,
    )
    assert.equal(await page.evaluate(() => window.uploads.length), 1)
    if (platform === 'mobile') {
      assert.equal(await page.evaluate(() => window.modalAlert()), true)
      await page.getByRole('button', { name: 'Cancel' }).click()
      assert.equal(await page.evaluate(() => window.modalAlert()), false)
      await open()
      assert.equal(await page.evaluate(() => window.modalAlert()), true)
      await page.evaluate(() => window.mount(false))
      assert.equal(await page.evaluate(() => window.modalAlert()), false)
    }
    await page.close()
    console.log(
      `${platform} thread context: complete history, errors, cancellation, owner, draft passed`,
    )
  }
} finally {
  await browser.close()
}

async function checkCommittedUploadCancellation(browser) {
  const resolveDir = root + 'packages/extension-tasks'
  const built = await bundleBrowser(
    {
      stdin: {
        resolveDir,
        loader: 'tsx',
        contents: `
import {useReducer,useState} from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';
import {ThreadContextPicker} from './src/chat/composer/thread-context-picker';import {useAttachments} from './src/chat/composer/use-attachments';
const keep=owner=>({id:owner+'-keep',name:owner+'-keep.txt',mime:'text/plain',size:4});
const computers=Object.fromEntries(['a','b'].map(owner=>[owner,{revision:1,files:[keep(owner)],cancelled:new Set()}]));
const connections=Object.fromEntries(['a','b'].map(owner=>[owner,{address:owner,token:owner}]));
window.calls=[];window.completedCancellations=0;window.serverFiles=owner=>computers[owner].files;
window.request=async(owner,path,input)=>{
  window.calls.push({owner,path,input});const server=computers[owner];
  if(path==='/api/tasks/history'){if(window.holdHistory)await new Promise(resolve=>window.releaseHistory=resolve);return {messages:[{id:'message',role:'user',text:'Snapshot text'}],turns:[],historyRevision:1}};
  if(path==='/api/attachments/remove'){
    if(window.failCleanup)throw Error('Cleanup unavailable');
    server.cancelled.add(input.id);server.files=server.files.filter(file=>file.id!==input.id);return {ok:true,revision:++server.revision};
  }
  if(path!=='/api/attachments/upload')throw Error('Unexpected '+path);
  if(window.holdCommit)await new Promise(resolve=>window.releaseCommit=resolve);
  if(server.cancelled.has(input.id))throw Error('Upload cancelled');
  const attachment={id:input.id,name:input.name,mime:'text/markdown',size:atob(input.data).length};server.files=[...server.files,attachment];const revision=++server.revision;
  if(window.holdResponse)await new Promise(resolve=>window.releaseResponse=resolve);
  if(window.loseResponse)throw Error('Upload response lost');return {attachment,revision};
};
function App(){
  const [owner,setOwner]=useState('a'),[revision,publish]=useReducer(value=>value+1,0);window.publish=()=>flushSync(publish);window.changeOwner=next=>flushSync(()=>setOwner(next));
  const server=computers[owner],tasks=[{id:'target',title:'Target',draftAttachments:server.files},{id:'source',title:'Source'}];
  window.context={workspace:{tasks},snapshot:{revision:server.revision,workspace:{tasks}},connected:true,connection:connections[owner],request:(path,input)=>window.request(owner,path,input)};
  const attachments=useAttachments(tasks[0]);window.files=attachments.files;window.busy=attachments.busy;
  return <><ThreadContextPicker taskId="target" disabled={false} attachmentBusy={attachments.busy} upload={attachments.uploadContext}/><p role="alert">{attachments.error}</p><p data-revision>{revision}</p></>;
}
createRoot(document.getElementById('app')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      conditions: ['development'],
      alias: { react: root + 'packages/studio-ui/node_modules/react' },
      nodePaths: [root + 'packages/studio-ui/node_modules', root + 'node_modules'],
    },
    [
      {
        path: '@dovo/protocol',
        contents: `export * from '${root}packages/protocol/src/index.ts';export const createRuntimeClient=connection=>({request:(path,input)=>window.request(connection.address,path,input)});`,
      },
      {
        path: '@dovo/studio-core',
        contents: `export * from '@dovo/protocol';export const useWorkspace=()=>window.context;`,
      },
      {
        path: '@dovo/studio-core/state',
        contents: `export {useState as useApplicationState} from 'react';`,
      },
      {
        path: './image-editor',
        importer: resolveDir,
        contents: `export const useImageEditor=()=>({edit:async file=>file,editor:null});`,
      },
      {
        path: '@dovo/studio-ui',
        contents: `export const Button=({children,onClick,disabled,...props})=><button {...props} disabled={disabled} onClick={onClick}>{children}</button>;export const Dialog=({children,open,onOpenChange})=>open?<div role="dialog">{children}<button onClick={()=>onOpenChange(false)}>Cancel</button></div>:null;export const DialogContent=({children})=><div>{children}</div>;export const DialogTitle=({children})=><h2>{children}</h2>;export const DialogDescription=({children})=><p>{children}</p>;`,
      },
    ],
  )
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://localhost:8351/**', (route) =>
    route.fulfill({ body: '<div id="app"></div>', contentType: 'text/html' }),
  )
  await page.goto('http://localhost:8351/')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const attach = async () => {
    await page.getByRole('button', { name: 'Attach thread context' }).click()
    await page.getByRole('button', { name: 'Source' }).click()
  }
  const waitReady = async () => {
    await page.evaluate(() => window.publish())
    await page.waitForFunction(() => !window.busy)
  }
  await page.evaluate(() => (window.holdHistory = true))
  await attach()
  await page.waitForFunction(() => !!window.releaseHistory)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.evaluate(() => {
    window.holdHistory = false
    window.releaseHistory()
  })
  await waitReady()
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.path === '/api/attachments/upload')),
    false,
  )
  for (const stage of ['commit', 'response', 'lost-response', 'owner']) {
    await page.evaluate((stage) => {
      window.holdCommit = stage === 'commit'
      window.holdResponse = stage !== 'commit'
      window.loseResponse = stage === 'lost-response'
      window.releaseCommit = null
      window.releaseResponse = null
    }, stage)
    await attach()
    await page.waitForFunction(() => !!window.releaseCommit || !!window.releaseResponse)
    if (stage === 'owner') await page.evaluate(() => window.changeOwner('b'))
    else await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForFunction(
      () =>
        window.calls.filter((call) => call.path === '/api/attachments/remove').length >
        window.completedCancellations,
    )
    // Cancellation settles on the removal acknowledgement, without waiting for the
    // held upload response. Reconnect must retain only the unrelated draft file.
    await waitReady()
    assert.equal(await page.evaluate(() => window.files.length), 1)
    await page.evaluate(() => {
      window.completedCancellations = window.calls.filter(
        (call) => call.path === '/api/attachments/remove',
      ).length
      ;(window.releaseCommit ?? window.releaseResponse)()
    })
    await waitReady()
    assert.deepEqual(await page.evaluate(() => window.serverFiles('a').map((file) => file.name)), [
      'a-keep.txt',
    ])
    assert.deepEqual(await page.evaluate(() => window.serverFiles('b').map((file) => file.name)), [
      'b-keep.txt',
    ])
    assert.equal(await page.getByRole('alert').textContent(), '')
    if (stage === 'owner') {
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.evaluate(() => window.changeOwner('a'))
      await waitReady()
    }
  }
  await page.evaluate(() => {
    window.holdCommit = false
    window.holdResponse = false
    window.loseResponse = false
  })
  await attach()
  await page.waitForFunction(() => window.serverFiles('a').length === 2)
  await waitReady()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.evaluate(() => window.files.length), 2)
  await page.evaluate(() => {
    window.holdResponse = true
    window.failCleanup = true
    window.releaseResponse = null
  })
  await attach()
  await page.waitForFunction(() => !!window.releaseResponse)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.evaluate(() => window.releaseResponse())
  await page.getByRole('alert').filter({ hasText: 'Could not cancel' }).waitFor()
  assert.deepEqual(errors, [])
  await page.close()
  console.log(
    'Real context attachment hook: cancellation before upload, during commit, after commit/lost response, original computer cleanup, normal success and visible cleanup errors passed.',
  )
}
