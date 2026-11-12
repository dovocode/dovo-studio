import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'

// Real hook, editor, question form and question cards. Runtime transport is deliberately
// offline; editor chunks cross a real HTTP boundary and can return a stale-build 404.
const root = fileURLToPath(new URL('../', import.meta.url))
const conversationSource = await readFile(
  root + 'packages/extension-tasks/src/detail/task-conversation.tsx',
  'utf8',
)
assert(
  conversationSource.includes(
    'const pendingScope = JSON.stringify([connection?.address, connection?.token, task.id])',
  ),
)
assert(conversationSource.includes('key={JSON.stringify([connection?.runtimeId, pendingScope])}'))
const built = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { useWorkspace, change, questionRecovery, useQuestionRecovery } from '@dovo/studio-core';
import { ComposerDraftRecovery } from './packages/extension-tasks/src/chat/composer/composer-draft-recovery';
import { useComposerDraft } from './packages/extension-tasks/src/chat/composer/use-composer-draft';
import { ComposerEditor } from './packages/extension-tasks/src/chat/composer/composer-editor';
import { ComposerModeToggle } from './packages/extension-tasks/src/chat/composer/composer-mode';
import { composerSelection } from './packages/extension-tasks/src/chat/composer/composer-input';
import { TaskQuestions } from './packages/extension-tasks/src/chat/thread/task-questions';
import { TooltipProvider } from './packages/studio-ui/src/components/ui/tooltip';
window.change = change; window.questionRecovery = questionRecovery;
function Composer({task}) {
  const input = useRef(null);
  const draft = useComposerDraft(task);
  window.draft = draft; window.caret = () => composerSelection(input.current, 0);
  return <><ComposerDraftRecovery text={draft.recoveryText} onDiscard={draft.discardRecovery}/><ComposerModeToggle input={input}/><ComposerEditor controller={draft.controller} input={input} taskId={task.id} historyScope={'runtime-' + window.identity} resources={{skills:[],mcpServers:[],agents:[]}} autoFocus={false} hidden={false} disabled={false} submitBusy={false} submittedText={null} placeholder="Message"/>{draft.error && <p role="alert">{draft.error}</p>}</>;
}
function App() {
  const context = useWorkspace();
  const [visible,setVisible] = useState(true); const [mount,setMount] = useState(0);
  const {scope} = useQuestionRecovery(); window.scope = scope;
  window.navigate = () => setVisible(value=>!value); window.remount = () => setMount(value=>value+1);
  return visible ? <><Composer key={JSON.stringify([context.connection?.runtimeId, JSON.stringify([context.connection?.address, context.connection?.token, context.workspace.tasks[0].id]), mount])} task={context.workspace.tasks[0]}/><TaskQuestions taskId="thread"/></> : <p>Other route</p>;
}
createRoot(document.getElementById('app')).render(<TooltipProvider><App/></TooltipProvider>);
`,
    resolveDir: root,
    loader: 'tsx',
  },
  nodePaths: [root + 'packages/extension-tasks/node_modules'],
  metafile: true,
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: '/recovery-fixture',
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'recovery-environment',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/studio-ui$/ }, () => ({
          path: 'ui',
          namespace: 'recovery',
        }))
        builder.onResolve({ filter: /^@dovo\/studio-core(?:\/state)?$/ }, ({ path }) => ({
          path,
          namespace: 'recovery',
        }))
        builder.onResolve({ filter: /^\.\/context$/ }, ({ importer }) =>
          importer.endsWith('/workspace/question-recovery.ts')
            ? { path: '@dovo/studio-core', namespace: 'recovery' }
            : undefined,
        )
        builder.onResolve({ filter: /^\.\/file-mentions$/ }, () => ({
          path: 'mentions',
          namespace: 'recovery',
        }))
        builder.onResolve({ filter: /^\.\/question-attachments$/ }, () => ({
          path: 'attachments',
          namespace: 'recovery',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'recovery' }, ({ path }) => ({
          loader: 'tsx',
          resolveDir: root,
          contents:
            path === 'ui'
              ? `export {QuestionForm} from './packages/studio-ui/src/question-form';
export {ComposerTextarea} from './packages/studio-ui/src/composer-surface';
export {Button} from './packages/studio-ui/src/components/ui/button';
export {IconButton} from './packages/studio-ui/src/components/icon-button';
export {cn} from './packages/studio-ui/src/lib/utils';`
              : path.endsWith('/state')
                ? "export {useState as useApplicationState} from 'react';"
                : path === 'mentions'
                  ? 'export const useFileMentions = () => ({track(){},onKeyDown(){},open:false,menu:null});'
                  : path === 'attachments'
                    ? 'export const QuestionAttachments = () => null;'
                    : `
import {useSyncExternalStore} from 'react';
export {composerCaretRecoveryKey,composerRecoveryKey,createComposerRecovery} from './packages/studio-core/src/workspace/composer-recovery';
export {questionRecovery,useQuestionRecovery} from './packages/studio-core/src/workspace/question-recovery';
export {responses} from '@dovo/protocol';
const listeners = new Set(); window.identity = 'a';
const task = {id:'thread',draft:''};
const question = {id:'request',taskId:'thread',createdAt:'',prompt:{title:'Review request',questions:[{id:'answer',question:'Your answer',header:'',options:[{value:'first',label:'First',description:''}],multiple:true,custom:true,secret:false,required:true,inputType:'text'},{id:'secret',question:'Password',header:'',options:[],multiple:false,custom:true,secret:true,required:true,inputType:'text'}]}};
let context = { workspace:{tasks:[task]}, snapshot:{workspace:{tasks:[task]},questions:[question]}, connection:{address:'http://lan:3000',token:'a'}, connected:true,
setWorkspace:null,
flush:async()=>{if(!window.syncOnline)throw Error('offline')}, request:async()=>{throw Error('offline')} };
function emit(){listeners.forEach(listener=>listener())}
function writerFor(connection){return update=>{if(context.connection!==connection)throw Error('Runtime connection changed');context={...context,workspace:typeof update==='function'?update(context.workspace):update};emit()}}
context.setWorkspace=writerFor(context.connection);
export const change = changes => {if(changes.identity){window.identity=changes.identity;changes.connection={address:'http://lan:3000',token:changes.identity};delete changes.identity}context={...context,...changes};if(changes.connection)context.setWorkspace=writerFor(changes.connection);emit()};
window.questionRequest=question;
window.removeQuestion=()=>change({snapshot:{...context.snapshot,questions:[]}});
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
export const useWorkspace=()=>useSyncExternalStore(subscribe,()=>context);
window.savedWorkspace=()=>context.workspace;
export const updateTask=(workspace,id,update)=>({...workspace,tasks:workspace.tasks.map(task=>task.id===id?update(task):task)});
let preferences={richTextComposer:localStorage.getItem('source')!=='true',sendWith:'enter'};
export const readAppPreferences=()=>preferences;
export const updateAppPreferences=changes=>{preferences={...preferences,...changes};localStorage.setItem('source',String(!preferences.richTextComposer));emit()};
export const useAppPreferences=()=>useSyncExternalStore(subscribe,()=>preferences);
export const useResolvedTheme=()=> 'dark';
`,
        }))
      },
    },
  ],
})
const files = new Map(built.outputFiles.map((file) => [file.path.split('/').at(-1), file.text]))
const entry = built.outputFiles
  .find((file) => file.path.endsWith('/stdin.js'))
  .path.split('/')
  .at(-1)
const editorChunks = new Set(
  Object.entries(built.metafile.outputs)
    .filter(([, info]) => info.entryPoint?.endsWith('rich-composer-editor.tsx'))
    .map(([path]) => path.split('/').at(-1)),
)
assert(editorChunks.size, 'No rich editor chunk found')
let rejectEditor = true
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://fixture').pathname.slice(1)
  if (!name) {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<div id="app"></div><script type="module" src="/${entry}"></script>`)
    return
  }
  if (rejectEditor && editorChunks.has(name)) {
    response.writeHead(404)
    response.end('Old chunk removed')
    return
  }
  const content = files.get(name)
  response.setHeader('Content-Type', 'text/javascript')
  response.writeHead(files.has(name) ? 200 : 404)
  response.end(content ?? 'missing')
})
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find(
    (address) =>
      address?.family === 'IPv4' && !address.internal && !address.address.startsWith('127.'),
  )
assert(lanAddress, 'The HTTP recovery check requires a non-loopback IPv4 interface')
await new Promise((resolve) => server.listen(0, lanAddress.address, resolve))
const url = `http://${lanAddress.address}:${server.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('Page error:', error.message)
  })
  await page.goto(url)
  assert.deepEqual(
    await page.evaluate(() => ({
      secure: isSecureContext,
      randomUUID: typeof crypto.randomUUID,
      protocol: location.protocol,
    })),
    { secure: false, randomUUID: 'undefined', protocol: 'http:' },
  )
  const source = page.locator('textarea[aria-label="Message thread"]')
  await page.getByText('Rich editor could not load.', { exact: false }).waitFor()
  // Close before the runtime debounce or a lifecycle flush can be relied on.
  await page.evaluate(() => window.draft.controller.update('Offline draft before debounce'))
  await page.reload()
  await assert.doesNotReject(() => source.waitFor())
  assert.equal(await source.inputValue(), 'Offline draft before debounce')
  await source.fill('Source remains editable after a chunk failure')
  await source.evaluate((element) => {
    element.focus()
    element.setSelectionRange(7, 13)
  })
  await page.evaluate(() => {
    window.originalSetItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem').value
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('dovo.composer-recovery')) throw Error('Retry protection failed')
      return window.originalSetItem.call(this, key, value)
    }
    window.retryMarker = 'must survive the failed retry'
  })
  await source.fill('Unprotected typing must survive Retry')
  await page.getByRole('button', { name: 'Retry rich editor' }).click()
  await page.getByText(/Could not save before reloading.*Retry protection failed/).waitFor()
  assert.equal(await page.evaluate(() => window.retryMarker), 'must survive the failed retry')
  assert.equal(await source.inputValue(), 'Unprotected typing must survive Retry')
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem
  })
  await source.fill('Source remains editable after a chunk failure')
  await source.evaluate((element) => {
    element.focus()
    element.setSelectionRange(7, 13)
  })
  rejectEditor = false
  // Browsers can cache a failed module evaluation. Reload deliberately retries the graph.
  await page.getByRole('button', { name: 'Retry rich editor' }).click()
  const rich = page.locator('[contenteditable=true][aria-label="Message thread"]')
  await rich.waitFor()
  assert.equal(
    await page.evaluate(() => window.draft.controller.text),
    'Source remains editable after a chunk failure',
  )
  assert.deepEqual(await page.evaluate(() => window.caret()), { start: 7, end: 13 })
  // Switch back to source and preserve a newer edit against a left composer's send result.
  await page.getByRole('button', { name: /Markdown source/ }).click()
  await source.waitFor()
  const remountComposer = async () => {
    await page.evaluate(() => {
      window.oldDraft = window.draft
      window.remountedFrom = window.draft.controller
      window.remount()
    })
    await page.waitForFunction(() => window.draft.controller !== window.remountedFrom)
    await source.waitFor()
  }
  await remountComposer()
  await source.fill('Same text typed again')
  await remountComposer()
  await page.evaluate(() => {
    window.beforeRetype = window.savedWorkspace()
  })
  await source.fill('')
  await source.fill('Same text typed again')
  await page.waitForFunction(
    () =>
      window.savedWorkspace() !== window.beforeRetype &&
      window.savedWorkspace().tasks[0].draft === 'Same text typed again',
  )
  await page.evaluate(() => window.oldDraft.accept('Same text typed again'))
  assert.equal(await source.inputValue(), 'Same text typed again')
  // Credential switches mount a distinct controller and never replay the previous identity.
  await page.evaluate(() =>
    window.change({ identity: 'b', workspace: { tasks: [{ id: 'thread', draft: '' }] } }),
  )
  await source.waitFor()
  assert.equal(await source.inputValue(), '')
  await source.fill('Other identity')
  await page.evaluate(() =>
    window.change({ identity: 'a', workspace: { tasks: [{ id: 'thread', draft: '' }] } }),
  )
  await source.waitFor()
  assert.equal(await source.inputValue(), 'Same text typed again')
  await page.evaluate(() => {
    window.previousController = window.draft.controller
    window.draft.controller.update('Pending before address change')
    window.change({
      connection: { address: 'http://vpn:3000', token: 'a' },
      workspace: { tasks: [{ id: 'thread', draft: '' }] },
    })
  })
  await source.waitFor()
  assert.equal(await source.inputValue(), '')
  assert.equal(
    await page.evaluate(() => window.previousController === window.draft.controller),
    false,
  )
  const beforeNewTyping = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith('dovo.composer-recovery'))
        .map((key) => [key, localStorage.getItem(key)]),
    ),
  )
  await source.fill('New address typing')
  const afterNewTyping = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith('dovo.composer-recovery'))
        .map((key) => [key, localStorage.getItem(key)]),
    ),
  )
  const oldKey = Object.keys(beforeNewTyping).find(
    (key) => JSON.parse(beforeNewTyping[key]).text === 'Pending before address change',
  )
  assert(oldKey)
  assert.equal(afterNewTyping[oldKey], beforeNewTyping[oldKey])
  await page.evaluate(() =>
    window.change({
      connection: { address: 'http://vpn:3000', token: 'b' },
      workspace: { tasks: [{ id: 'thread', draft: '' }] },
    }),
  )
  await source.waitFor()
  assert.equal(await source.inputValue(), '')
  await page.evaluate(() =>
    window.change({
      connection: { address: 'http://vpn:3000', token: 'a', runtimeId: 'r1' },
      workspace: { tasks: [{ id: 'thread', draft: '' }] },
    }),
  )
  await source.waitFor()
  assert.equal(await source.inputValue(), '')
  await source.fill('Known runtime draft')
  await page.evaluate(() =>
    window.change({
      connection: { address: 'http://lan:3000', token: 'a', runtimeId: 'r1' },
      workspace: { tasks: [{ id: 'thread', draft: '' }] },
    }),
  )
  await source.waitFor()
  assert.equal(await source.inputValue(), 'Known runtime draft')
  await page.evaluate(() =>
    window.change({
      connection: { address: 'http://lan:3000', token: 'a', runtimeId: 'r2' },
      workspace: { tasks: [{ id: 'thread', draft: '' }] },
    }),
  )
  await source.waitFor()
  assert.equal(await source.inputValue(), '')
  await page.evaluate(() =>
    window.change({
      connection: { address: 'http://lan:3000', token: 'a' },
      workspace: { tasks: [{ id: 'thread', draft: '' }] },
    }),
  )
  await source.waitFor()
  assert.equal(await source.inputValue(), 'Pending before address change')
  await source.fill('Same text typed again')
  // Ordinary answers survive unmount, refresh, cancellation and explicit recovery.
  const answer = page.getByRole('textbox', { name: 'Answer: Your answer', exact: true })
  await answer.fill('Keep this answer exactly')
  await page.getByRole('button', { name: /First/ }).click()
  await page.getByLabel('Answer: Password', { exact: true }).fill('PRIVATE-ANSWER-DO-NOT-SAVE')
  await page.evaluate(() => window.navigate())
  await page.getByText('Other route').waitFor()
  await page.evaluate(() => window.navigate())
  await answer.waitFor()
  assert.equal(await answer.inputValue(), 'Keep this answer exactly')
  assert.equal(
    await page.getByRole('button', { name: /First/ }).getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(await page.getByLabel('Answer: Password', { exact: true }).inputValue(), '')
  assert.equal(
    await page.evaluate(() =>
      Object.keys(localStorage).some((key) =>
        localStorage.getItem(key)?.includes('PRIVATE-ANSWER-DO-NOT-SAVE'),
      ),
    ),
    false,
  )
  await page.reload()
  await answer.waitFor()
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="Answer: Your answer"]')?.value ===
      'Keep this answer exactly',
  )
  await page.evaluate(() => window.removeQuestion())
  await page.getByText('Saved answers · Review request').click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Saved answer: Your answer' }).inputValue(),
    'first\nKeep this answer exactly',
  )
  assert.equal(await source.inputValue(), 'Same text typed again')
  await page.getByRole('button', { name: 'Discard saved answers' }).click()
  assert.equal(await page.getByText('Saved answers · Review request').count(), 0)
  // A failed local write must leave the text editable and recoverable when storage returns.
  await page.evaluate(() => {
    window.originalSetItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem').value
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('dovo.composer-recovery')) throw Error('Injected quota failure')
      return window.originalSetItem.call(this, key, value)
    }
  })
  await source.fill('Recover after storage failure')
  await page.getByText(/Could not save the draft.*Injected quota failure/).waitFor()
  assert.equal(await source.inputValue(), 'Recover after storage failure')
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem
    window.draft.flush()
  })
  await page.reload()
  await source.waitFor()
  assert.equal(await source.inputValue(), 'Recover after storage failure')
  // A successful draft sync can precede the offline workspace cache. Keep its text as an
  // optional backup, rather than overwriting a different workspace draft on reload.
  await page.evaluate(() => {
    window.syncOnline = true
    window.draft.controller.update('Synced unsent draft before cache refresh')
    window.draft.flush()
  })
  await page.waitForFunction(() =>
    Object.keys(localStorage).some(
      (key) =>
        key.startsWith('dovo.composer-recovery') &&
        JSON.parse(localStorage.getItem(key)).backup === 'Synced unsent draft before cache refresh',
    ),
  )
  await page.reload()
  await page.getByText('Saved local draft', { exact: true }).click()
  assert.equal(
    await page.getByRole('textbox', { name: 'Saved local draft', exact: true }).inputValue(),
    'Synced unsent draft before cache refresh',
  )
  assert.equal(await source.inputValue(), '')
  await page.getByRole('button', { name: 'Discard saved local draft' }).click()
  assert.equal(await page.getByText('Saved local draft', { exact: true }).count(), 0)
  const latency = await page.evaluate(() => {
    const results = []
    for (const size of [1000, 10000, 100000, 1000000]) {
      const text = 'x'.repeat(size)
      const samples = []
      for (let index = 0; index < 30; index++) {
        const start = performance.now()
        window.draft.controller.update(text + index)
        samples.push(performance.now() - start)
      }
      samples.sort((a, b) => a - b)
      results.push({ characters: size, p50Ms: samples[15], p95Ms: samples[28], maxMs: samples[29] })
    }
    window.draft.controller.update('')
    window.draft.flush()
    return results
  })
  console.log(
    'Synchronous controller update and local protection latency:',
    JSON.stringify(latency),
  )
  // Real localStorage read failure, edits while unread data is preserved, and explicit retry.
  await page.evaluate(() =>
    window.questionRecovery.update(window.scope, window.questionRequest, {
      answer: { selected: ['first'], text: 'Unread saved ordinary answer' },
    }),
  )
  const retryPage = await context.newPage()
  await retryPage.addInitScript(() => {
    const read = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem').value
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('dovo.question-recovery') && !window.allowQuestionRead)
        throw Error('Injected transient read failure')
      return read.call(this, key)
    }
  })
  await retryPage.goto(url)
  await retryPage
    .getByText(/Could not restore question answers.*Injected transient read failure/)
    .waitFor()
  const retryAnswer = retryPage.getByRole('textbox', { name: 'Answer: Your answer', exact: true })
  const unreadBefore = await page.evaluate(() =>
    JSON.stringify(
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => key.startsWith('dovo.question-recovery.'))
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    ),
  )
  await retryAnswer.fill('Edited before Retry')
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(
        Object.fromEntries(
          Object.keys(localStorage)
            .filter((key) => key.startsWith('dovo.question-recovery.'))
            .map((key) => [key, localStorage.getItem(key)]),
        ),
      ),
    ),
    unreadBefore,
  )
  await retryPage.evaluate(() => {
    window.allowQuestionRead = true
  })
  await retryPage.getByRole('button', { name: 'Retry saved answers', exact: true }).click()
  await retryPage
    .getByRole('button', { name: 'Retry saved answers', exact: true })
    .waitFor({ state: 'detached' })
  assert.equal(await retryAnswer.inputValue(), 'Edited before Retry')
  assert.match(
    await page.evaluate(() =>
      JSON.stringify(
        Object.fromEntries(
          Object.keys(localStorage)
            .filter((key) => key.startsWith('dovo.question-recovery.'))
            .map((key) => [key, localStorage.getItem(key)]),
        ),
      ),
    ),
    /Edited before Retry/,
  )
  await retryPage.close()
  // Two already-open detached windows must persist independent requests, including deletes.
  const otherPage = await context.newPage()
  await otherPage.goto(url)
  await otherPage.getByRole('textbox', { name: 'Answer: Your answer', exact: true }).waitFor()
  await otherPage.evaluate(() => window.questionRecovery.load(window.scope))
  await Promise.all([
    page.evaluate(() =>
      window.questionRecovery.update(
        window.scope,
        { ...window.questionRequest, id: 'window-a', taskId: 'thread-a' },
        { answer: { selected: [], text: 'Detached window A' } },
      ),
    ),
    otherPage.evaluate(() =>
      window.questionRecovery.update(
        window.scope,
        { ...window.questionRequest, id: 'window-b', taskId: 'thread-b' },
        { answer: { selected: [], text: 'Detached window B' } },
      ),
    ),
  ])
  const checkPage = await context.newPage()
  await checkPage.goto(url)
  await checkPage.waitForFunction(
    () =>
      window.questionRecovery
        ?.entries(window.scope)
        .some((entry) => entry.request.id === 'window-a') &&
      window.questionRecovery
        .entries(window.scope)
        .some((entry) => entry.request.id === 'window-b'),
  )
  await page.evaluate(() => window.questionRecovery.remove(window.scope, 'thread-a', 'window-a'))
  await otherPage.evaluate(() =>
    window.questionRecovery.update(
      window.scope,
      { ...window.questionRequest, id: 'window-b', taskId: 'thread-b' },
      { answer: { selected: [], text: 'B after A discard' } },
    ),
  )
  await checkPage.reload()
  await checkPage.waitForFunction(() =>
    window.questionRecovery
      ?.entries(window.scope)
      .some((entry) => entry.drafts.answer?.text === 'B after A discard'),
  )
  assert.equal(
    await checkPage.evaluate(() =>
      window.questionRecovery
        .entries(window.scope)
        .some((entry) => entry.request.id === 'window-a'),
    ),
    false,
  )
  await otherPage.evaluate(() =>
    window.questionRecovery.remove(window.scope, 'thread-b', 'window-b'),
  )
  await page.evaluate(() =>
    window.questionRecovery.update(
      window.scope,
      { ...window.questionRequest, id: 'window-c', taskId: 'thread-c' },
      { answer: { selected: [], text: 'Pending window C' } },
    ),
  )
  await checkPage.reload()
  await checkPage.waitForFunction(() =>
    window.questionRecovery?.entries(window.scope).some((entry) => entry.request.id === 'window-c'),
  )
  assert.equal(
    await checkPage.evaluate(() =>
      window.questionRecovery
        .entries(window.scope)
        .some((entry) => entry.request.id === 'window-a' || entry.request.id === 'window-b'),
    ),
    false,
  )
  // A delayed successful answer from one window consumes only its submitted revision.
  await page.evaluate(() => {
    const request = { ...window.questionRequest, id: 'shared-request', taskId: 'shared-thread' }
    window.questionRecovery.update(window.scope, request, {
      answer: { selected: [], text: 'Submitted shared answer' },
    })
    window.submittedShared = window.questionRecovery
      .entries(window.scope)
      .find((entry) => entry.request.id === 'shared-request')
  })
  await otherPage.evaluate(() =>
    window.questionRecovery.update(
      window.scope,
      { ...window.questionRequest, id: 'shared-request', taskId: 'shared-thread' },
      { answer: { selected: [], text: 'Newer other-window answer' } },
    ),
  )
  await page.evaluate(() =>
    window.questionRecovery.remove(
      window.scope,
      'shared-thread',
      'shared-request',
      window.submittedShared,
    ),
  )
  await checkPage.reload()
  await checkPage.waitForFunction(() =>
    window.questionRecovery
      ?.entries(window.scope)
      .some(
        (entry) =>
          entry.request.id === 'shared-request' &&
          entry.drafts.answer.text === 'Newer other-window answer',
      ),
  )
  // Identical text typed in a newer revision must also survive the stale callback.
  await page.evaluate(() => {
    window.questionRecovery.update(
      window.scope,
      { ...window.questionRequest, id: 'shared-request', taskId: 'shared-thread' },
      { answer: { selected: [], text: 'Identical shared answer' } },
    )
    window.submittedShared = window.questionRecovery
      .entries(window.scope)
      .find((entry) => entry.request.id === 'shared-request')
  })
  await otherPage.evaluate(() =>
    window.questionRecovery.update(
      window.scope,
      { ...window.questionRequest, id: 'shared-request', taskId: 'shared-thread' },
      { answer: { selected: [], text: 'Identical shared answer' } },
    ),
  )
  await page.evaluate(() =>
    window.questionRecovery.remove(
      window.scope,
      'shared-thread',
      'shared-request',
      window.submittedShared,
    ),
  )
  await checkPage.reload()
  await checkPage.waitForFunction(() =>
    window.questionRecovery
      ?.entries(window.scope)
      .some(
        (entry) =>
          entry.request.id === 'shared-request' &&
          entry.drafts.answer.text === 'Identical shared answer',
      ),
  )
  await otherPage.close()
  await checkPage.close()
  assert.deepEqual(errors, [])
  console.log(
    'Composer recovery browser checks passed on non-loopback HTTP (isSecureContext=false, crypto.randomUUID absent): offline reload, real chunk 404/reload, editing, delayed acknowledgement, identity switches, question remount/reload/cancellation, independent detached windows and secret exclusion.',
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
