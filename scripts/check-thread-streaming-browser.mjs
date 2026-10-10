import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const mocks = {
  './pull-link-actions': `export const PullLinkActions=()=>null;`,
  '@dovo/studio-core': `export * from '@dovo/protocol'; const store={workspace:{tasks:[]},connected:true,request:async()=>({ok:true})}; export const useWorkspace=()=>store; export const useStudioHost=()=>({}); export const formatDateTime=()=>'';export const useAppPreferences=()=>({responseStreaming:'tokens'});export const completedStreamingText=text=>text;`,
  '@dovo/studio-ui': `import React from 'react';export * as ContextMenu from '@radix-ui/react-context-menu';export const Conversation=({children,...props})=><div {...props}>{children}</div>;export const ConversationContent=Conversation;export const ConversationHistory=Conversation;export const Message=({children,id})=><div id={id}>{children}</div>;export const MessageContent=Conversation;export const MessageResponse=({children})=>{window.markdownRenders++;return <p>{children}</p>};export const ConversationRail=()=>null;export const ConversationScrollButton=()=>null;export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const IconButton=Button;`,
  './deferred-turn': `export const DeferredTurn=({children})=>children();`,
  './task-activity': `import {useSyncExternalStore} from 'react';import {createRecentTools} from '@dovo/protocol';const project=createRecentTools();const listeners=new Set();let tools=[];window.updateTools=next=>{tools=project(next);for(const listener of listeners)listener()};const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};export const useTaskActivity=()=>({tools:useSyncExternalStore(subscribe,()=>tools),error:''});export const TaskActivity=()=>null;`,
}
for (const path of [
  './turn-checkpoint',
  '../composer/message-attachments',
  './message-copy',
  '../actions/run-in-terminal',
  '../actions/fork-turn',
  '../actions/retry-turn',
  './turn-label',
]) {
  const name = {
    './turn-checkpoint': 'TurnCheckpoint',
    '../composer/message-attachments': 'MessageAttachments',
    './message-copy': 'MessageCopy',
    '../actions/run-in-terminal': 'RunInTerminal',
    '../actions/fork-turn': 'ForkTurn',
    '../actions/retry-turn': 'RetryTurn',
    './turn-label': 'TurnLabel',
  }[path]
  mocks[path] = `export const ${name}=()=>null;`
}
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {ChatThread} from './src/chat/thread/chat-thread.tsx';
window.markdownRenders=0;window.timelineCalls=0;
const messages=Array.from({length:500},(_,index)=>({id:String(index),role:index%2?'assistant':'user',text:'Message '+index}));
const turns=messages.filter(m=>m.role==='assistant').map((m,index)=>({id:'turn-'+index,assistantId:m.id,status:index===249?'running':'completed',startedAt:'2026-10-02T12:00:00Z',finishedAt:index===249?undefined:'2026-10-02T12:00:01Z'}));
function App(){const [task,setTask]=useState({id:'thread',status:'running',messages,turns});window.stream=()=>setTask(old=>({...old,messages:old.messages.map((message,index)=>index===499?{...message,text:message.text+'x'}:message)}));window.complete=()=>setTask(old=>({...old,status:'completed',turns:old.turns.map(turn=>turn.status==='running'?{...turn,status:'completed'}:turn)}));return <ChatThread task={task}/>;}
createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: fileURLToPath(new URL('../packages/extension-tasks/', import.meta.url)),
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'thread-environment',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'thread-environment' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'thread-environment' }, ({ path }) => ({
          contents: mocks[path],
          resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
          loader: 'tsx',
        }))
        builder.onLoad({ filter: /conversation\/timeline\.ts$/ }, async ({ path }) => ({
          contents: (await readFile(path, 'utf8')).replace(
            '  const boundaries =',
            '  window.timelineCalls++;\n  const boundaries =',
          ),
          loader: 'ts',
        }))
      },
    },
  ],
  bundle: true,
  alias: {
    '@dovo/protocol': fileURLToPath(new URL('../packages/protocol/src/index.ts', import.meta.url)),
  },
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => document.getElementById('message-thread-499'))
  await page.evaluate(() => {
    window.events = Array.from({ length: 250 }, (_, index) => ({
      id: 'tool-' + index,
      scope: 'thread',
      kind: 'tool',
      summary: 'Command',
      time: '2026-10-02T12:00:00Z',
      payload: JSON.stringify({
        turnId: 'turn-' + index,
        toolId: 'tool-' + index,
        status: index === 249 ? 'running' : 'completed',
        event: { item: { command: 'echo ' + index } },
      }),
    }))
    window.updateTools(window.events)
  })
  await page.waitForFunction(() => window.timelineCalls === 500)
  const baseline = await page.evaluate(() => ({
    timelines: window.timelineCalls,
    markdown: window.markdownRenders,
  }))
  const start = performance.now()
  for (let index = 1; index <= 20; index++) {
    await page.evaluate(() => window.stream())
    await page.waitForFunction(
      (index) =>
        document
          .getElementById('message-thread-499')
          .textContent.includes('Message 499' + 'x'.repeat(index)),
      index,
    )
  }
  const streamed = await page.evaluate(() => ({
    timelines: window.timelineCalls,
    markdown: window.markdownRenders,
  }))
  console.log(
    JSON.stringify({
      baseline,
      streamed,
      extraTimelines: streamed.timelines - baseline.timelines,
      extraMarkdown: streamed.markdown - baseline.markdown,
      elapsedMs: Math.round(performance.now() - start),
    }),
  )
  if (
    process.env.DOVO_PROFILE_ONLY !== '1' &&
    (streamed.timelines - baseline.timelines > 20 || streamed.markdown - baseline.markdown > 20)
  )
    throw new Error('Streaming rerendered settled thread history')
  const toolsBaseline = await page.evaluate(() => window.timelineCalls)
  for (let index = 1; index <= 20; index++) {
    await page.evaluate(
      (index) =>
        window.updateTools(
          window.events.map((event, at) =>
            at === 249
              ? {
                  ...event,
                  payload: JSON.stringify({
                    turnId: 'turn-249',
                    toolId: 'tool-249',
                    status: 'running',
                    event: { item: { command: 'echo latest-' + index } },
                  }),
                }
              : event,
          ),
        ),
      index,
    )
    await page.waitForFunction(
      (expected) => window.timelineCalls === expected,
      toolsBaseline + index,
    )
  }
  console.log('20 tool updates rebuilt only the active message timeline.')
  await page.evaluate(() => window.complete())
  await page.waitForFunction(() =>
    document.getElementById('message-thread-499').textContent.includes('Message 499'),
  )
  if (errors.length) throw new Error(errors.join('\n'))
} finally {
  await browser.close()
}
