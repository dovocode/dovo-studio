import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const adapters = [
  {
    path: 'react-native',
    contents: `export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Image=({source})=><img src={source.uri}/>;export const Pressable=({children,onPress,accessibilityLabel})=><button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;`,
  },
  ...['../../draft/runtime-drafts', '../../../tasks/draft/runtime-drafts'].map((path) => ({
    path,
    contents: `export const appendRuntimeDraft=async(...args)=>window.appends.push(args);export const prepareRuntimeSideThread=async(runtime,task,id,objective)=>{const key=runtime+task;const old=window.pending[key];if(old?.objective===objective)return old.id;window.pending[key]={id,objective};return id};export const finishRuntimeSideThread=async(runtime,task,id)=>{if(window.pending[runtime+task]?.id===id)delete window.pending[runtime+task]};`,
  })),
  {
    path: 'expo-router',
    contents: `export const router={push:target=>window.routes.push(target),replace:target=>window.routes.push(target)};`,
  },
  { path: 'expo-crypto', contents: `export const randomUUID=()=> 'child-'+(++window.ids);` },
  {
    path: '../../../runtime/connection/provider',
    contents: `export const useRuntime=()=>window.runtime;`,
  },
  {
    path: '../../../ui/theme',
    contents: `export const useTheme=()=>({styles:{muted:{},error:{color:'red'}}});`,
  },
  {
    path: '../../../ui/content/text',
    contents: `export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;`,
  },
  {
    path: '../../../ui/controls/action',
    contents: `export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  },
  {
    path: '../../../ui/controls/choice',
    contents: `export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(i=><option key={i.id} value={i.id} disabled={i.disabled}>{i.name}</option>)}</select></label>;`,
  },
  {
    path: '../../../ui/controls/field',
    contents: `export const Field=({label,value,onChangeText,editable})=><label>{label}<input aria-label={label} value={value} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/></label>;`,
  },
  {
    path: '../../../ui/controls/use-action',
    contents: `import {useState,useRef} from 'react';export const useAction=()=>{const [busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef(false);return{busy,error,act:work=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');Promise.resolve().then(work).catch(e=>setError(e.message)).finally(()=>{pending.current=false;setBusy(false)})}}};`,
  },
  {
    path: '../../../ui/layout/sheet',
    contents: `import {useImperativeHandle} from 'react';export const Sheet=({ref,title,children})=>{useImperativeHandle(ref,()=>({dismiss:after=>after?.()}));return <section aria-label={title}>{children}</section>};`,
  },
]
for (const path of [
  'runtime/connection/provider',
  'ui/theme',
  'ui/content/text',
  'ui/controls/action',
  'ui/controls/choice',
  'ui/layout/sheet',
]) {
  const original = adapters.find((adapter) => adapter.path === '../../../' + path)
  adapters.push({ path: '../../' + path, contents: original.contents })
}
adapters.push(
  {
    path: '../../ui/content/code-block',
    contents: 'export const CodeBlock=({content})=><pre>{content}</pre>;',
  },
  {
    path: '../../ui/content/syntax-highlighter',
    contents: "export const fileLanguage=()=> 'text';",
  },
  {
    path: '../preview/diff-view',
    contents:
      'export const DiffView=({path,before,after})=><output aria-label="Snapshot diff">{path}: {before} → {after}</output>;',
  },
)
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {AgentSideChats,SideThreadActions,SideChatAttention} from '${mobile}tasks/conversation/components/agent-side-chats.tsx';
import {SideThreadChanges} from '${mobile}tasks/detail/side-thread-changes.tsx';
import {PullAgentChat} from '${mobile}scm/pulls/detail/agent-chat.tsx';
window.pending={};window.ids=0;window.routes=[];window.calls=[];window.appends=[];
const parent={id:'parent',repositoryId:'repo',title:'Main thread',status:'review',draft:'Keep my draft',messages:[],linkedPullRequests:[{number:7,url:'https://github.com/team/project/pull/7'}]};
const child={id:'child',title:'Review side chat',status:'review',messages:[{id:'reply',role:'assistant',text:'Result'}],turns:[{id:'turn',status:'completed',assistantId:'reply'}],sideThread:{parentTaskId:'parent',contextMessageCount:0}};
window.runtime={connected:true,profile:{id:'mac',connection:{address:'http://mac.lan'}},snapshot:{approvals:[],questions:[],workspace:{tasks:[parent,child],repositories:[{id:'repo',name:'Project'}]}},call:async(path,input)=>{window.calls.push({path,input});if(path.endsWith('discard')){window.runtime.snapshot.workspace.tasks=window.runtime.snapshot.workspace.tasks.filter(task=>task.id!==input.id);return{ok:true}}if(window.hold)return new Promise(resolve=>{window.finish=()=>resolve({id:'late'})});if(window.fail){window.fail=false;throw Error('Temporary disconnection')}return path.endsWith('bring-back')?{id:'parent',receiptId:'child:turn',text:'Completed result'}:{id:'created'}}};
window.reads=[];window.changesAfter='after-one';window.runtime.read=async(path,input)=>{window.reads.push({path,input});if(path.endsWith('/changes')){if(window.failRead){window.failRead=false;throw Error('Wait for the side thread to finish')};return {before:'creation-snapshot',after:window.changesAfter,files:[{path:'child.ts',before:'old',after:'new',viewed:false},{path:'other.ts',before:'old',after:'new',viewed:false}],omitted:window.omittedPaths??[]}}return {before:{kind:'text',text:'old',size:3,truncated:false},after:{kind:'text',text:input.full?'full-new':'new',size:3,truncated:!input.full},patch:'@@ -1 +1 @@\\n-old\\n+new'}};
const detail={pull:{number:7,title:'Review PR',url:'https://github.com/team/project/pull/7',repositoryUrl:'https://github.com/team/project',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),head:'feature',base:'main',destination:'account-A'},files:[{path:'src/main.ts',status:'modified',patch:'@@ -1 +1 @@\\n-old\\n+new',additions:1,deletions:1}],comments:[],warnings:[],checks:[]};
window.prLatestDetail=detail;
const root=createRoot(document.getElementById('app'));
let revision=0;window.show=(mode,patch={},remount=true)=>flushSync(()=>{if(remount)revision++;Object.assign(window.runtime,patch);root.render(mode==='changes'?<SideThreadChanges key={revision} taskId='child' onClose={()=>{}}/>:mode==='attention'?<SideChatAttention key={revision} task={parent}/>:mode==='actions'?<SideThreadActions key={revision} task={child}/>:mode==='pr'?<PullAgentChat key={revision} repositoryId='repo' sourceIdentity={window.prSource??'revision-one'} detail={detail} latestDetail={window.prLatestDetail} path='src/main.ts' onClose={()=>{}}/>:<AgentSideChats key={revision} task={parent} onClose={()=>{}} onLegacy={()=>{window.legacy=true}}/>)});
window.changeParent=patch=>Object.assign(parent,patch);window.changeChild=patch=>Object.assign(child,patch);
window.show('list');
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  adapters.map((stub) => (stub.path.startsWith('.') ? { ...stub, importer: mobile } : stub)),
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<main id="app"></main>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'Review side chat · review' }).click()
  assert.equal(await page.evaluate(() => window.routes.at(-1).params.taskId), 'child')
  // A failed create keeps the same request ID and does not run a coding turn.
  await page.evaluate(() => {
    window.fail = true
  })
  await page.getByRole('button', { name: 'New side chat', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Temporary disconnection' }).waitFor()
  await page.evaluate(() => window.show('list'))
  await page.getByRole('button', { name: 'New side chat', exact: true }).click()
  await page.waitForFunction(() => window.routes.at(-1).params.taskId === 'created')
  const creates = await page.evaluate(() => window.calls)
  assert.equal(creates[0].input.childId, creates[1].input.childId)
  assert.equal(
    creates.every((call) => call.path === '/api/tasks/side-thread/create'),
    true,
  )
  await page.evaluate(() => {
    window.show('actions')
    window.calls = []
  })
  await page.getByRole('button', { name: 'Bring back', exact: true }).click()
  await page.waitForFunction(() => window.calls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.calls[0]), {
    path: '/api/tasks/side-thread/bring-back',
    input: { id: 'child', expectedDraft: 'Keep my draft' },
  })
  await page.waitForFunction(() => window.appends.length === 1)
  assert.deepEqual(await page.evaluate(() => window.appends[0]), [
    'mac',
    'parent',
    'Completed result',
    'Keep my draft',
    'child:turn',
    undefined,
  ])
  for (const patch of [
    { status: 'running' },
    { status: 'review', queue: [{ id: 'queued' }] },
    { queue: [], archivedAt: '2026-10-31T00:00:00Z' },
  ]) {
    await page.evaluate((patch) => {
      window.changeParent(patch)
      window.show('actions')
    }, patch)
    assert.equal(
      await page.getByRole('button', { name: 'Bring back', exact: true }).isDisabled(),
      true,
    )
  }
  await page.evaluate(() => {
    window.changeParent({ status: 'review', queue: [], archived: true, archivedAt: undefined })
    window.show('pr')
    window.calls = []
  })
  // Settled parents remain eligible; choosing one is explicit.
  // No linked parent is selected implicitly. The new review thread is an explicit action.
  assert.equal(await page.getByLabel('Conversation', { exact: true }).inputValue(), '')
  await page.getByLabel('Conversation', { exact: true }).selectOption('parent')
  await page.getByLabel('Question or task', { exact: true }).fill('Check the deletion')
  await page.getByLabel('Diff side', { exact: true }).selectOption('deletions')
  await page.getByLabel('Start line (optional)', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Create agent side chat', exact: true }).click()
  await page.waitForFunction(() => window.calls.length === 1)
  const handoff = await page.evaluate(() => window.calls[0])
  assert.equal(handoff.path, '/api/tasks/side-thread/create')
  assert.equal(handoff.input.id, 'parent')
  assert.equal(handoff.input.objective.includes('a'.repeat(40)), true)
  assert.equal(handoff.input.objective.includes('b'.repeat(40)), true)
  assert.equal(handoff.input.objective.includes('src/main.ts'), true)
  assert.equal(handoff.input.objective.includes('"side": "deletions"'), true)
  await page.evaluate(() => window.show('pr', { connected: false }))
  assert.equal(
    await page.getByRole('button', { name: 'Create review thread', exact: true }).isDisabled(),
    true,
  )
  // A response from the old runtime cannot navigate after switching away and back.
  await page.evaluate(() => {
    window.show('list', { connected: true })
    window.hold = true
    window.routes = []
  })
  await page.getByRole('button', { name: 'New side chat', exact: true }).click()
  await page.waitForFunction(() => !!window.finish)
  await page.evaluate(() => {
    const original = window.runtime.profile
    window.show('list', { profile: { ...original, id: 'other' } }, false)
    window.show('list', { profile: original }, false)
    window.finish()
    window.hold = false
  })
  await page
    .getByRole('button', { name: 'New side chat', exact: true })
    .waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('button').disabled)
  assert.deepEqual(await page.evaluate(() => window.routes), [])
  // A changed PR account/revision invalidates the frozen review action.
  await page.evaluate(() => window.show('pr'))
  await page.evaluate(() => {
    window.prSource = 'revision-two'
    window.show('pr', {}, false)
  })
  assert.equal(
    await page.getByRole('button', { name: 'Create review thread', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('alert').filter({ hasText: 'PR source changed' }).waitFor()
  // A same-account push preserves the question, explicitly re-pins and clears old line ranges.
  await page.evaluate(() => {
    window.show('pr')
    window.calls = []
  })
  await page.getByLabel('Question or task', { exact: true }).fill('Keep my question after the push')
  await page.getByLabel('Start line (optional)', { exact: true }).fill('1')
  await page.evaluate(() => {
    window.prLatestDetail = {
      ...window.prLatestDetail,
      pull: { ...window.prLatestDetail.pull, headSha: 'c'.repeat(40) },
    }
    window.show('pr', {}, false)
  })
  assert.equal(
    await page.getByRole('button', { name: 'Create review thread', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('button', { name: 'Use latest revision', exact: true }).click()
  assert.equal(
    await page.getByLabel('Question or task', { exact: true }).inputValue(),
    'Keep my question after the push',
  )
  assert.equal(await page.getByLabel('Start line (optional)', { exact: true }).inputValue(), '')
  await page.getByRole('button', { name: 'Create review thread', exact: true }).click()
  await page.waitForFunction(() => window.calls.length === 1)
  const latest = await page.evaluate(() => window.calls[0].input)
  assert.equal(latest.headSha, 'c'.repeat(40))
  assert.equal(latest.objective.includes('Keep my question after the push'), true)
  // Child human-input state is visible and opens the owning side chat, including worker inputs.
  await page.evaluate(() => {
    window.runtime.snapshot.approvals = [{ taskId: 'child' }]
    window.show('list')
  })
  await page.getByRole('button', { name: 'Review side chat · Needs approval' }).waitFor()
  await page.evaluate(() => window.show('attention'))
  await page.getByRole('button', { name: 'Open approval', exact: true }).click()
  assert.equal(await page.evaluate(() => window.routes.at(-1).params.taskId), 'child')
  await page.evaluate(() => {
    window.runtime.snapshot.approvals = []
    window.runtime.snapshot.questions = [{ taskId: 'child', routing: 'human' }]
    window.show('attention')
  })
  await page.getByRole('button', { name: 'Open question', exact: true }).waitFor()
  // Discard is explicit and calls only the guarded unused-child endpoint.
  await page.evaluate(() => {
    window.runtime.snapshot.questions = []
    window.runtime.snapshot.workspace.tasks.push({
      id: 'unused',
      title: 'Unused draft',
      status: 'draft',
      turns: [],
      sideThread: { parentTaskId: 'parent' },
    })
    window.show('list')
    window.calls = []
  })
  await page.getByRole('button', { name: 'Discard Unused draft', exact: true }).click()
  await page.waitForFunction(() => window.calls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.calls[0]), {
    path: '/api/tasks/side-thread/discard',
    input: { id: 'unused' },
  })
  assert.equal(
    await page.evaluate(() =>
      window.runtime.snapshot.workspace.tasks.some((task) => task.id === 'unused'),
    ),
    false,
  )
  // The real saved-file preview requests only the pinned child snapshot, including full previews.
  await page.evaluate(() => {
    window.reads = []
    window.show('changes')
  })
  await page.getByLabel('Changed file', { exact: true }).waitFor()
  await page.getByLabel('Changed file', { exact: true }).selectOption('other.ts')
  await page.waitForFunction(() =>
    window.reads.some(
      (read) => read.path.endsWith('/file-preview') && read.input.path === 'other.ts',
    ),
  )
  await page.getByRole('button', { name: 'Load full diff', exact: true }).click()
  await page
    .getByLabel('Snapshot diff', { exact: true })
    .filter({ hasText: 'other.ts: old → full-new' })
    .waitFor()
  const preview = await page.evaluate(() => window.reads.at(-1))
  assert.equal(preview.path, '/api/tasks/side-thread/file-preview')
  assert.deepEqual(preview.input, {
    id: 'child',
    path: 'other.ts',
    before: 'creation-snapshot',
    after: 'after-one',
    full: true,
  })
  await page.evaluate(() => {
    window.changesAfter = 'after-two'
  })
  await page.getByRole('button', { name: 'Refresh changes', exact: true }).click()
  await page.waitForFunction(() =>
    window.reads.some(
      (read) => read.path.endsWith('/file-preview') && read.input.after === 'after-two',
    ),
  )
  assert.equal(await page.getByLabel('Changed file', { exact: true }).inputValue(), 'other.ts')
  await page.evaluate(() => {
    window.failRead = true
  })
  await page.getByRole('button', { name: 'Refresh changes', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Wait for the side thread to finish' }).waitFor()
  assert.equal(await page.getByLabel('Changed file', { exact: true }).inputValue(), 'other.ts')
  // Bounded comparison omissions remain selectable and load from the same saved snapshot.
  await page.evaluate(() => {
    window.omittedPaths = ['large.bin']
  })
  await page.getByRole('button', { name: 'Refresh changes', exact: true }).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('option')].some((option) => option.value === 'large.bin'),
  )
  await page.getByLabel('Changed file', { exact: true }).selectOption('large.bin')
  await page.waitForFunction(() =>
    window.reads.some(
      (read) => read.path.endsWith('/file-preview') && read.input.path === 'large.bin',
    ),
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile full-agent side chats, retry IDs, bring-back guards and revision-bound PR handoff passed',
  )
} finally {
  await browser.close()
}
