import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const environment = `export const AppState={addEventListener:(_event,handler)=>{window.background=handler;return {remove:()=>{}}}};export const useWorkspace=()=>window.connection;export const useRuntime=()=>({...window.connection,profile:{connection:window.connection.connection},read:window.connection.request,readCache:window.cache});`
async function checkLiveDeletion(page) {
  await page.evaluate(() => {
    window.connection = {
      ...window.connection,
      connected: true,
      request: async () => ({
        messages: [{ id: 'older', role: 'assistant', text: 'Older' }],
        turns: [],
      }),
    }
    window.setLive({
      id: 'deletion',
      historyBefore: 'live',
      turns: [],
      messages: [
        { id: 'live', role: 'assistant', text: 'Current' },
        { id: 'deleted-feedback', role: 'user', text: 'Review comment' },
        { id: 'last', role: 'assistant', text: 'Last' },
      ],
    })
  })
  await page.waitForFunction(() => window.historyState.task.id === 'deletion')
  await page.evaluate(() => window.historyState.load())
  await page.waitForFunction(
    () => !window.historyState.busy && window.historyState.task.messages.length === 4,
  )
  await page.evaluate(() =>
    window.setLive((old) => ({
      ...old,
      messages: old.messages.filter((message) => message.id !== 'deleted-feedback'),
    })),
  )
  await page.waitForFunction(
    () =>
      window.historyState.task.messages.map((message) => message.id).join(',') ===
      'older,live,last',
  )
  await page.evaluate(() =>
    window.setLive((old) => ({ ...old, historyBefore: undefined, messages: [old.messages[0]] })),
  )
  await page.waitForFunction(
    () => window.historyState.task.messages.map((message) => message.id).join(',') === 'live',
  )
}
async function checkHistoryRevision(page) {
  await page.evaluate(() => {
    window.revision = 0
    window.connection = {
      ...window.connection,
      connected: true,
      request: async () => ({
        historyRevision: window.revision,
        messages:
          window.revision === 0
            ? [
                { id: 'older-valid', role: 'assistant', text: 'Older' },
                { id: 'older-feedback', role: 'user', text: 'Remove' },
              ]
            : [
                {
                  id: window.revision === 1 ? 'older-valid' : 'rewound-older',
                  role: 'assistant',
                  text: 'Older',
                },
              ],
        turns: [],
      }),
    }
    window.setLive({
      id: 'revision',
      historyRevision: 0,
      historyBefore: 'current-80',
      turns: [],
      messages: [
        { id: 'current-80', role: 'assistant', text: 'Current' },
        { id: 'current-81', role: 'assistant', text: 'Last' },
      ],
    })
  })
  await page.waitForFunction(() => window.historyState.task.id === 'revision')
  await page.evaluate(() => window.historyState.load())
  await page.waitForFunction(
    () => !window.historyState.busy && window.historyState.task.messages.length === 4,
  )
  await page.evaluate(() => {
    window.revision = 1
    window.setLive((old) => ({ ...old, historyRevision: 1 }))
  })
  await page.waitForFunction(
    () =>
      !window.historyState.busy &&
      window.historyState.task.messages.map((message) => message.id).join(',') ===
        'older-valid,current-80,current-81',
  )
  await page.evaluate(() => {
    window.revision = 2
    window.setLive((old) => ({
      ...old,
      historyRevision: 2,
      historyBefore: 'rewound-50',
      messages: [
        { id: 'rewound-50', role: 'assistant', text: 'Rewound' },
        { id: 'rewound-51', role: 'assistant', text: 'Rewound last' },
      ],
    }))
  })
  await page.waitForFunction(
    () =>
      !window.historyState.busy &&
      window.historyState.task.messages.map((message) => message.id).join(',') ===
        'rewound-older,rewound-50,rewound-51',
  )
}
async function checkExpandedRevision(page) {
  await page.evaluate(() => {
    window.revision = 0
    window.connection = {
      ...window.connection,
      connected: true,
      request: async (_path, { before }) => {
        const end = Number(before.slice(1))
        const start = Math.max(0, end - 50)
        return {
          historyRevision: window.revision,
          messages: Array.from({ length: end - start }, (_, index) => ({
            id: `m${start + index}`,
            role: 'assistant',
            text: 'Older',
          })).filter((message) => window.revision === 0 || message.id !== 'm100'),
          turns: [],
          ...(start ? { before: `m${start}` } : {}),
        }
      },
    }
    window.setLive({
      id: 'expanded',
      historyRevision: 0,
      historyBefore: 'm430',
      messages: Array.from({ length: 20 }, (_, index) => ({
        id: `m${430 + index}`,
        role: 'assistant',
        text: 'Current',
      })),
      turns: [],
    })
  })
  await page.waitForFunction(() => window.historyState.task.id === 'expanded')
  while (await page.evaluate(() => window.historyState.hasMore)) {
    await page.waitForFunction(() => !window.historyState.busy)
    await page.evaluate(() => window.historyState.load())
    await page.waitForFunction(() => !window.historyState.busy)
  }
  await page.waitForFunction(() => window.historyState.task.messages.length === 450)
  await page.evaluate(() => {
    window.revision = 1
    window.setLive((old) => ({ ...old, historyRevision: 1 }))
  })
  await page.waitForFunction(
    () =>
      !window.historyState.busy &&
      window.historyState.task.messages.length === 449 &&
      window.historyState.task.messages[0]?.id === 'm0',
  )
  if (await page.evaluate(() => window.historyState.task.messages.some((m) => m.id === 'm100')))
    throw new Error('Expanded history resurrected removed older feedback')
}
async function checkWindowGap(page) {
  await page.evaluate(() => {
    window.connection = {
      ...window.connection,
      connected: true,
      request: async (_path, { before }) => {
        const end = Number(before.slice(1))
        const start = Math.max(0, end - 50)
        return {
          messages: Array.from({ length: end - start }, (_, i) => ({
            id: `m${start + i}`,
            role: 'assistant',
            text: 'Older',
          })),
          turns: [],
          ...(start ? { before: `m${start}` } : {}),
        }
      },
    }
    window.setLive({
      id: 'gap',
      historyBefore: 'm300',
      turns: [],
      messages: [300, 301].map((id) => ({ id: `m${id}`, role: 'assistant', text: 'Current' })),
    })
  })
  await page.waitForFunction(() => window.historyState.task.id === 'gap')
  await page.evaluate(() => window.historyState.load())
  await page.waitForFunction(
    () => !window.historyState.busy && window.historyState.task.messages.length > 2,
  )
  const count = await page.evaluate(() => window.historyState.task.messages.length)
  await page.evaluate(() =>
    window.setLive((old) => ({
      ...old,
      historyBefore: 'm500',
      messages: [500, 501].map((id) => ({ id: `m${id}`, role: 'assistant', text: 'Current' })),
    })),
  )
  await page.waitForFunction(
    (count) =>
      !window.historyState.busy &&
      window.historyState.task.messages.length >= count &&
      window.historyState.task.messages.at(-1)?.id === 'm501',
    count,
  )
  const ids = await page.evaluate(() =>
    window.historyState.task.messages.map((m) => Number(m.id.slice(1))),
  )
  if (ids.some((id, i) => id !== ids[0] + i))
    throw new Error('A new live window left a gap in expanded history')
}
async function checkPendingWindowGap(page) {
  await page.evaluate(() => {
    window.pendingGapReplies = []
    window.connection = {
      ...window.connection,
      connected: true,
      request: (_path, { before }) =>
        new Promise((resolve) => {
          window.pendingGapReplies.push({ before, resolve })
        }),
    }
    window.setLive({
      id: 'pending-gap',
      historyBefore: 'm300',
      turns: [],
      messages: [300, 301].map((id) => ({ id: `m${id}`, role: 'assistant', text: 'Current' })),
    })
  })
  await page.waitForFunction(() => window.historyState.task.id === 'pending-gap')
  await page.evaluate(() => {
    void window.historyState.load()
  })
  await page.waitForFunction(() => window.pendingGapReplies.length === 1)
  await page.evaluate(() =>
    window.setLive((old) => ({
      ...old,
      historyBefore: 'm500',
      messages: [500, 501].map((id) => ({ id: `m${id}`, role: 'assistant', text: 'Current' })),
    })),
  )
  await page.waitForFunction(() => window.historyState.task.messages[0]?.id === 'm500')
  await page.evaluate(() =>
    window.pendingGapReplies[0].resolve({
      messages: Array.from({ length: 50 }, (_, i) => ({
        id: `m${250 + i}`,
        role: 'assistant',
        text: 'Stale',
      })),
      turns: [],
      before: 'm250',
    }),
  )
  await page.waitForTimeout(20)
  const ids = await page.evaluate(() =>
    window.historyState.task.messages.map((message) => message.id).join(','),
  )
  if (ids !== 'm500,m501')
    throw new Error('A stale page resurrected history across a live window gap')
  await page.evaluate(() => {
    void window.historyState.load()
  })
  await page.waitForFunction(() => window.pendingGapReplies.length === 2)
  if ((await page.evaluate(() => window.pendingGapReplies[1].before)) !== 'm500')
    throw new Error('History retained the stale gap cursor')
  await page.evaluate(() =>
    window.pendingGapReplies[1].resolve({
      messages: Array.from({ length: 50 }, (_, i) => ({
        id: `m${450 + i}`,
        role: 'assistant',
        text: 'Fresh',
      })),
      turns: [],
      before: 'm450',
    }),
  )
  await page.waitForFunction(() => window.historyState.task.messages.length === 52)
  const current = await page.evaluate(() =>
    window.historyState.task.messages.map((message) => Number(message.id.slice(1))),
  )
  if (current.some((id, i) => id !== 450 + i))
    throw new Error('Fresh history failed to refill the current window')
}
async function checkMobileRestoreRace(page) {
  await page.evaluate(() => {
    window.cache = {
      ...window.cache,
      read: () =>
        new Promise((resolve) => {
          window.restoreRelease = () =>
            resolve({
              value: {
                messages: Array.from({ length: 201 }, (_, i) => ({
                  id: `m${i}`,
                  role: 'assistant',
                  text: 'Cached',
                })),
                turns: [],
              },
            })
        }),
    }
    window.setLive({
      id: 'restore-race',
      historyBefore: 'm126',
      turns: [],
      messages: Array.from({ length: 75 }, (_, i) => ({
        id: `m${126 + i}`,
        role: 'assistant',
        text: 'Current',
      })),
    })
  })
  await page.waitForFunction(
    () => window.historyState.task.id === 'restore-race' && !!window.restoreRelease,
  )
  await page.evaluate(() =>
    window.setLive((old) => ({
      ...old,
      historyBefore: 'm127',
      messages: [...old.messages.slice(1), { id: 'm201', role: 'assistant', text: 'New' }],
    })),
  )
  await page.waitForFunction(() => window.historyState.task.messages.at(-1)?.id === 'm201')
  await page.evaluate(() => window.restoreRelease())
  await page.waitForFunction(() => window.historyState.task.messages.length === 202)
  const ids = await page.evaluate(() =>
    window.historyState.task.messages.map((m) => Number(m.id.slice(1))),
  )
  if (ids.some((id, i) => id !== i)) throw new Error('Delayed cache restore left a missing message')
  await page.evaluate(() => {
    window.failedRestoreWrites = 0
    window.cache = {
      read: async () => {
        throw new Error('Temporary storage read failure')
      },
      write: async (key) => {
        if (key === 'conversation:restore-failure') window.failedRestoreWrites++
      },
    }
    window.connection = { ...window.connection, connected: false }
    window.setLive({ id: 'restore-failure', messages: [], turns: [] })
  })
  await page.waitForFunction(
    () =>
      window.historyState.task.id === 'restore-failure' &&
      window.historyState.error.includes('Could not restore'),
  )
  await page.evaluate(() => window.background('background'))
  if (await page.evaluate(() => window.failedRestoreWrites))
    throw new Error('Failed offline restore overwrote saved history')
}
async function checkConversationScroll(browser) {
  const built = await build({
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';import {useState,useEffect} from 'react';
import {Conversation,ConversationContent,ConversationHistory,useConversationHistory} from './packages/studio-ui/src/components/ai-elements/conversation.tsx';
function Inspector(){const {ready,scrollRef}=useConversationHistory();useEffect(()=>{window.scrollReady=ready;window.scroller=scrollRef.current});return null}
function App(){const [older,setOlder]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(false);window.setScrollError=setError;
const load=()=>{window.scrollLoads++;setBusy(true);window.resolveScrollPage=()=>{setOlder(n=>n+10);setBusy(false)}};
return <Conversation style={{height:400}}><ConversationHistory onLoadEarlier={!busy&&!error?load:undefined}><ConversationContent>
{Array.from({length:20+older},(_,i)=>i-older).map(i=><div key={i} id={'row-'+i} style={{height:100}}>Message {i}</div>)}<Inspector/>
</ConversationContent></ConversationHistory></Conversation>}
window.scrollLoads=0;createRoot(document.getElementById('app')).render(<App/>);`,
      loader: 'tsx',
      resolveDir: root,
    },
    plugins: [
      {
        name: 'scroll-state',
        setup(builder) {
          builder.onResolve({ filter: /^@dovo\/studio-core\/state$/ }, () => ({
            path: 'state',
            namespace: 'scroll',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'scroll' }, () => ({
            contents: "export {useState as useApplicationState} from 'react'",
            resolveDir: `${root}packages/studio-ui`,
            loader: 'js',
          }))
        },
      },
    ],
    nodePaths: [`${root}packages/studio-ui/node_modules`],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.scrollReady && window.scroller.scrollTop >= 1500)
  if (await page.evaluate(() => window.scrollLoads))
    throw new Error('History paging fired before scrolling back')
  await page.evaluate(() => {
    window.scroller.scrollTop = 700
  })
  await page.waitForFunction(() => window.scrollLoads === 1)
  const before = await page.locator('#row-7').boundingBox()
  await page.evaluate(() => window.resolveScrollPage())
  await page.waitForFunction(() => !!document.getElementById('row--10'))
  const after = await page.locator('#row-7').boundingBox()
  if (Math.abs(after.y - before.y) > 2) throw new Error('Older history moved the visible message')
  if ((await page.evaluate(() => window.scrollLoads)) !== 1)
    throw new Error('Paging continued after leaving the history boundary')
  await page.evaluate(() => window.setScrollError(true))
  await page.evaluate(() => {
    window.scroller.scrollTop = 0
  })
  await page.waitForTimeout(50)
  if ((await page.evaluate(() => window.scrollLoads)) !== 1)
    throw new Error('History errors caused automatic retries')
  await page.close()
}
async function checkProductionPaging(browser) {
  const built = await build({
    stdin: {
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {TaskConversation} from './packages/extension-tasks/src/detail/task-conversation.tsx';
window.productionRevision=7;
window.connection={connected:true,connection:{address:'http://host-a',token:'paired-a'},request:async()=>({
 historyRevision:window.productionRevision,turns:[],messages:[{id:'m0',role:'assistant',text:'Older'},
 ...(window.productionRevision===7?[{id:'m1',role:'user',text:'Removed feedback'}]:[])]})};
function App(){const [task,setTask]=useState({id:'production',title:'Production',agentId:'',repositoryId:'',
 status:'review',createdAt:'',example:false,draft:'',files:[],turns:[],historyBefore:'m2',historyRevision:7,
 messages:[{id:'m2',role:'assistant',text:'Current'},{id:'m3',role:'assistant',text:'Last'}]});
 window.setProductionTask=setTask;return <TaskConversation task={task} historyLoaded visible={false} onReview={()=>{}}/>}
createRoot(document.getElementById('app')).render(<App/>);`,
      loader: 'tsx',
      resolveDir: root,
    },
    alias: {
      '@dovo/protocol': `${root}packages/protocol/src/index.ts`,
      react: dirname(
        createRequire(new URL('../packages/studio-ui/package.json', import.meta.url)).resolve(
          'react/package.json',
        ),
      ),
      'react-dom': dirname(
        createRequire(new URL('../packages/studio-ui/package.json', import.meta.url)).resolve(
          'react-dom/package.json',
        ),
      ),
    },
    plugins: [
      {
        name: 'production-boundary',
        setup(builder) {
          builder.onResolve(
            { filter: /^@dovo\/studio-core(?:\/state)?$|^@dovo\/studio-ui$/ },
            (args) => ({ path: args.path, namespace: 'production' }),
          )
          builder.onResolve({ filter: /^\.\./ }, (args) =>
            args.importer.endsWith('/detail/task-conversation.tsx') &&
            args.path !== '../chat/artifact-open-context'
              ? { path: args.path, namespace: 'production' }
              : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'production' }, (args) => {
            let contents
            if (args.path === '@dovo/studio-core/state')
              contents = "export {useState as useApplicationState} from 'react'"
            else if (args.path === '@dovo/studio-core')
              contents =
                "export * from '@dovo/protocol';export const useWorkspace=()=>window.connection;export const useAppPreferences=()=>({collapseComposerOnScroll:false});export const formatDateTime=()=>''"
            else if (args.path === '@dovo/studio-ui') contents = 'export const Button=()=>null'
            else if (args.path.endsWith('chat-thread'))
              contents = `
import {useConversationHistory} from '${root}packages/extension-tasks/src/chat/thread/use-conversation-history.ts';
export function ChatThread({task}){const h=useConversationHistory(task);window.productionHistory=h;
return <div>{h.hasMore&&<button onClick={()=>h.load()}>Load earlier messages</button>}</div>}`
            else if (args.path.endsWith('use-task-viewed'))
              contents = "export const useTaskViewed=()=>({error:'',retry:()=>{}})"
            else {
              const names = {
                'message-queue': 'MessageQueue',
                'task-questions': 'TaskQuestions',
                'run-controls': 'RunControls',
                composer: 'Composer',
                'task-empty-state': 'TaskEmptyState',
                'preparation-progress': 'PreparationProgress',
                'review-comments-tray': 'ReviewCommentsTray',
                'plan-approval': 'PlanApproval',
                'review-findings': 'ReviewFindings',
                'task-pull-link-dialog': 'TaskPullLinkDialog',
              }
              const name = names[args.path.split('/').at(-1)]
              if (!name) throw new Error(`Missing production fixture module ${args.path}`)
              contents = `export const ${name}=()=>null`
            }
            return { contents, loader: 'tsx', resolveDir: root }
          })
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
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.productionHistory.task.messages.length === 4)
  await page.evaluate(() => {
    window.productionRevision = 8
    window.setProductionTask((old) => ({ ...old, historyRevision: 8 }))
  })
  await page.waitForFunction(
    () =>
      !window.productionHistory.busy &&
      window.productionHistory.task.messages.map((m) => m.id).join(',') === 'm0,m2,m3',
  )
  if (errors.length) throw new Error(errors.join('\n'))
  await page.close()
}
const browser = await chromium.launch({ headless: true })
try {
  for (const file of [
    'packages/extension-tasks/src/chat/thread/use-conversation-history.ts',
    'apps/mobile/src/tasks/conversation/state/use-conversation-history.ts',
  ]) {
    const built = await build({
      alias: {
        react: dirname(
          createRequire(new URL('../packages/studio-ui/package.json', import.meta.url)).resolve(
            'react/package.json',
          ),
        ),
      },
      stdin: {
        contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {useConversationHistory} from './${file}';
window.requests=0;window.connection={connected:true,connection:{address:'http://host-a',token:'paired-a'},request:()=>new Promise((resolve,reject)=>{window.requests++;window.reply={resolve,reject}})};
const message=id=>({id,role:'assistant',text:id});
function App(){const [live,setLive]=useState(window.initial??{id:'thread',messages:[message('m2'),message('m3')],turns:[],historyBefore:'m2'});window.setLive=setLive;window.historyState=useConversationHistory(live);return <div>{window.historyState.task.messages.map(m=>m.id).join(',')}</div>}
const root=createRoot(document.getElementById('app'));let restart=0;window.restart=()=>root.render(<App key={++restart}/>);root.render(<App/>);`,
        loader: 'tsx',
        resolveDir: root,
      },
      plugins: [
        {
          name: 'history-environment',
          setup(builder) {
            builder.onResolve(
              { filter: /^(@dovo\/studio-core|.*runtime\/connection\/provider|react-native)$/ },
              () => ({ path: 'environment', namespace: 'history' }),
            )
            builder.onLoad({ filter: /.*/, namespace: 'history' }, () => ({
              contents: environment,
              loader: 'js',
            }))
          },
        },
      ],
      nodePaths: [fileURLToPath(new URL('../packages/studio-ui/node_modules', import.meta.url))],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    console.log(`Checking ${file}`)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.waitForFunction(() => window.historyState?.task?.messages.length === 2)
    if (file.startsWith('apps/mobile/')) {
      await page.waitForFunction(() => window.historyState.busy)
      await page.evaluate(() => {
        window.connection.request = async (_path, { before }) => {
          window.requests++
          const end = Number(before.slice(1))
          const start = Math.max(0, end - 50)
          return {
            messages: Array.from({ length: end - start }, (_, index) => ({
              id: `m${start + index}`,
              role: 'assistant',
              text: `Message ${start + index}`,
            })),
            turns: [],
            ...(start ? { before: `m${start}` } : {}),
          }
        }
        const saved = new Map()
        window.cache = {
          read: async (key) => (saved.has(key) ? { value: saved.get(key) } : null),
          write: async (key, value) => saved.set(key, value),
        }
        window.saved = saved
        window.setLive({
          id: 'large',
          messages: [998, 999].map((id) => ({
            id: `m${id}`,
            role: 'assistant',
            text: `Message ${id}`,
          })),
          turns: [],
          historyBefore: 'm998',
        })
      })
      await page.waitForFunction(
        () => window.historyState.task.messages.length >= 500 && !window.historyState.busy,
      )
      const count = await page.evaluate(() => window.requests)
      if (count !== 11) throw new Error('Mobile did not automatically fetch ten bounded pages')
      await page.evaluate(() =>
        window.setLive((old) => ({
          ...old,
          messages: [...old.messages, { id: 'm1000', role: 'assistant', text: 'Streaming' }],
        })),
      )
      await page.waitForFunction(() => window.historyState.task.messages.at(-1)?.id === 'm1000')
      if ((await page.evaluate(() => window.requests)) !== count)
        throw new Error('Streaming fetched redundant history')
      await page.evaluate(() => {
        window.connection = { ...window.connection, connected: false }
        window.setLive({ id: 'other', messages: [], turns: [] })
      })
      await page.waitForFunction(
        () => window.saved.get('conversation:large')?.messages.length === 500,
      )
      await page.evaluate(() => {
        window.initial = { id: 'large', messages: [], turns: [] }
        window.restart()
      })
      await page.waitForFunction(() => window.historyState.task.messages.length === 500)
      if ((await page.evaluate(() => window.historyState.task.messages.at(-1)?.id)) !== 'm1000')
        throw new Error('Offline reopen lost the latest reply')
      if ((await page.evaluate(() => window.requests)) !== count)
        throw new Error('Offline cache restore fetched network history')
      await page.evaluate(() =>
        window.reply.resolve({
          messages: [{ id: 'stale', role: 'assistant', text: 'Wrong thread' }],
          turns: [],
        }),
      )
      await page.waitForTimeout(20)
      if (
        await page.evaluate(() => window.historyState.task.messages.some((m) => m.id === 'stale'))
      )
        throw new Error('Late response leaked between threads')
      await page.evaluate(() => {
        window.connection = { ...window.connection, connected: true }
        window.setLive({
          id: 'large',
          messages: [1700, 1701].map((id) => ({
            id: `m${id}`,
            role: 'assistant',
            text: `Message ${id}`,
          })),
          turns: [],
          historyBefore: 'm1700',
        })
      })
      await page.waitForFunction(
        () => !window.historyState.busy && window.historyState.task.messages[0]?.id === 'm1200',
      )
      if ((await page.evaluate(() => window.requests)) !== count + 10)
        throw new Error('Reconnect failed to refill a gap in cached history')
      await page.evaluate(() => window.background('background'))
      await page.waitForFunction(
        () => window.saved.get('conversation:large')?.messages.at(-1)?.id === 'm1701',
      )
      await page.evaluate(() => {
        window.initial = {
          id: 'large',
          messages: [1690, 1691].map((id) => ({
            id: `m${id}`,
            role: 'assistant',
            text: `Message ${id}`,
          })),
          turns: [],
          historyBefore: 'm1690',
        }
        window.restart()
      })
      await page.waitForFunction(
        () =>
          !window.historyState.busy &&
          window.historyState.task.messages.length >= 500 &&
          window.historyState.task.messages.at(-1)?.id === 'm1691',
      )
      if (
        await page.evaluate(() =>
          window.historyState.task.messages.some((message) => Number(message.id.slice(1)) > 1691),
        )
      )
        throw new Error('Cache resurrected messages removed by a rewind')
      await page.evaluate(() => {
        window.connection.request = async (_path, { before }) => {
          window.requests++
          return { messages: [], turns: [], before }
        }
        window.setLive({
          id: 'broken',
          messages: [{ id: 'broken-last', role: 'assistant', text: 'Last' }],
          turns: [],
          historyBefore: 'broken-last',
        })
      })
      await page.waitForFunction(
        () => !window.historyState.busy && window.historyState.error.includes('did not advance'),
      )
      if ((await page.evaluate(() => window.requests)) !== count + 12)
        throw new Error('Invalid history cursor triggered an automatic retry loop')
      if (errors.length) throw new Error(errors.join('\n'))
      await checkLiveDeletion(page)
      await checkHistoryRevision(page)
      await checkExpandedRevision(page)
      await checkWindowGap(page)
      await checkMobileRestoreRace(page)
      await page.close()
      continue
    }
    await page.waitForFunction(() => window.requests === 1 && window.historyState.busy)
    await page.evaluate(() => {
      window.historyState.load()
    })
    await page.evaluate(() =>
      window.setLive((old) => ({
        ...old,
        messages: [
          { id: 'm3', role: 'assistant', text: 'm3' },
          { id: 'm4', role: 'assistant', text: 'm4' },
        ],
        historyBefore: 'm3',
      })),
    )
    await page.waitForFunction(() => window.historyState.task.messages.some((m) => m.id === 'm4'))
    await page.evaluate(() =>
      window.reply.resolve({
        messages: [
          { id: 'm0', role: 'user', text: 'm0' },
          { id: 'm1', role: 'assistant', text: 'm1' },
        ],
        turns: [],
      }),
    )
    await page.waitForFunction(
      () => !window.historyState.busy && window.historyState.task.messages.length === 5,
    )
    if (
      (await page.evaluate(() => window.historyState.task.messages.map((m) => m.id).join(','))) !==
      'm0,m1,m2,m3,m4'
    )
      throw new Error(`${file}: streaming lost paged history`)
    if ((await page.evaluate(() => window.requests)) !== 1)
      throw new Error(`${file}: duplicate history request during streaming`)
    await page.evaluate(() => window.historyState.setBookmark('m1', true))
    await page.waitForFunction(
      () => window.historyState.task.messages.find((m) => m.id === 'm1')?.bookmarked,
    )
    await page.evaluate(() =>
      window.setLive((old) => ({ ...old, historyBefore: 'm3', historyRevision: 1 })),
    )
    await page.waitForFunction(() => window.historyState.busy)
    await page.evaluate(() => {
      window.connection = {
        ...window.connection,
        connection: { address: 'http://host-b', token: 'paired-b' },
      }
      window.setLive({
        id: 'other',
        messages: [{ id: 'other-message', role: 'user', text: 'other' }],
        turns: [],
      })
    })
    await page.waitForFunction(() => window.historyState.task.id === 'other')
    await page.evaluate(() =>
      window.reply.resolve({
        messages: [{ id: 'wrong-host', role: 'assistant', text: 'wrong' }],
        turns: [],
      }),
    )
    await page.waitForTimeout(20)
    if (
      await page.evaluate(() =>
        window.historyState.task.messages.some((m) => m.id !== 'other-message'),
      )
    )
      throw new Error(`${file}: stale host history leaked`)
    await page.evaluate(() => window.setLive((old) => ({ ...old, historyBefore: 'other-message' })))
    await page.waitForFunction(() => window.historyState.hasMore)
    await page.evaluate(() => {
      window.historyState.load()
    })
    await page.evaluate(() => window.reply.reject(new Error('Temporary history failure')))
    await page.waitForFunction(() => !window.historyState.busy && !!window.historyState.error)
    await page.evaluate(() => {
      window.historyState.load()
    })
    await page.evaluate(() =>
      window.reply.resolve({
        messages: [{ id: 'earlier-other', role: 'user', text: 'Earlier' }],
        turns: [],
      }),
    )
    await page.waitForFunction(
      () =>
        !window.historyState.busy &&
        !window.historyState.error &&
        window.historyState.task.messages.length === 2,
    )
    if (errors.length) throw new Error(errors.join('\n'))
    await checkLiveDeletion(page)
    await checkHistoryRevision(page)
    await checkExpandedRevision(page)
    await checkWindowGap(page)
    await checkPendingWindowGap(page)
    await page.evaluate(() => {
      window.desktopFillRequests = 0
      window.connection.request = async (_path, { before }) => {
        window.desktopFillRequests++
        const end = Number(before.slice(1)),
          start = Math.max(0, end - 50)
        return {
          messages: Array.from({ length: end - start }, (_, i) => ({
            id: `m${start + i}`,
            role: 'assistant',
            text: 'Older',
          })),
          turns: [],
          ...(start ? { before: `m${start}` } : {}),
        }
      }
      window.setLive({
        id: 'desktop-large',
        messages: [998, 999].map((i) => ({ id: `m${i}`, role: 'assistant', text: 'Recent' })),
        turns: [],
        historyBefore: 'm998',
      })
    })
    await page.waitForFunction(
      () => !window.historyState.busy && window.historyState.task.messages.length >= 500,
    )
    if ((await page.evaluate(() => window.desktopFillRequests)) !== 10)
      throw new Error('Desktop did not fill a bounded recent window')
    await page.close()
  }
  await checkProductionPaging(browser)
  await checkConversationScroll(browser)
  console.log(
    'History checks passed: 500-message loading, offline restoration, background saves, reconnect gaps, rewinds, live and older deletions, revision invalidation, cursor errors and host isolation.',
  )
} finally {
  await browser.close()
}
