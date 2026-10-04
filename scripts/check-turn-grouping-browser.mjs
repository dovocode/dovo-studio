import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const fixture = `
import {useState,createContext,useContext} from 'react';
import {createRoot} from 'react-dom/client';
import {conversationPresentation,conversationMessages,conversationToolsByMessage,recentTools} from 'fixture-projection';
export const Context=createContext(null),MessageContext=createContext(null);
export const useFixture=()=>useContext(Context);
const startedAt='2026-10-03T10:00:01Z';
const turn={id:'attempt',runId:'run',assistantId:'after',agentId:'agent',provider:'codex',model:'',status:'completed',startedAt,finishedAt:'2026-10-03T10:01:00Z'};
const initial={id:'thread',title:'Thread',status:'done',messages:[
{id:'request',turnId:'attempt',role:'user',text:'Original request',createdAt:'2026-10-03T10:00:00Z'},
{id:'before',turnId:'attempt',role:'assistant',text:'First update.Second update.',textBreaks:[13,27],createdAt:'2026-10-03T10:00:02Z'},
{id:'steer',turnId:'attempt',role:'user',text:'Clarification',createdAt:'2026-10-03T10:00:10Z'},
{id:'after',turnId:'attempt',role:'assistant',text:'Linking works on right-click or long-press.Final answer.',textBreaks:[43,56],createdAt:'2026-10-03T10:00:11Z'}],turns:[turn],files:[],draft:''};
const events=[{id:'last',time:'2026-10-03T10:00:50Z',scope:'thread',kind:'tool',summary:'Command',payload:JSON.stringify({turnId:'attempt',messageId:'after',toolId:'last',status:'completed',textOffset:56,event:{item:{type:'commandExecution',command:'git diff'}}})},{id:'command',time:'2026-10-03T10:00:20Z',scope:'thread',kind:'tool',summary:'Command',payload:JSON.stringify({turnId:'attempt',messageId:'after',toolId:'command',status:'completed',textOffset:35,event:{item:{type:'commandExecution',command:'git status'}}})},{id:'prior',time:'2026-10-03T10:00:05Z',scope:'thread',kind:'tool',summary:'Command',payload:JSON.stringify({turnId:'attempt',messageId:'before',toolId:'prior',status:'completed',textOffset:13,event:{item:{type:'commandExecution',command:'pnpm test'}}})}];
window.events=events;export function App(){const[task,setTask]=useState(initial),[collapsedTurns,setCollapsed]=useState({});window.setTask=setTask;const presentation=conversationPresentation(task);const messages=conversationMessages(task,events);const value={task,presentation,messages,events,tools:recentTools(events),collapsedTurns,toggleTurn:id=>setCollapsed(old=>({...old,[id]:!(old[id]??presentation.get('before').groupTurn.status==='completed')})),workspace:{tasks:[task]},connected:true,request:async()=>({ok:true}),history:{hasMore:false,busy:false,error:'',setBookmark:()=>{}},legacyEvents:[],activityError:'',followRequest:0};return <Context.Provider value={value}>CONTENT</Context.Provider>}
`
const ui = `
export * as ContextMenu from '@radix-ui/react-context-menu';export const Conversation=({children,...props})=><div {...props}>{children}</div>;
export const ConversationContent=({children})=><div>{children}</div>,ConversationHistory=ConversationContent;
export const Message=({children,id})=><div id={id}>{children}</div>,MessageContent=ConversationContent;
export const MessageResponse=({children})=><p data-prose>{children}</p>;
export const Button=({children,onClick,disabled,...props})=><button aria-expanded={props['aria-expanded']} disabled={disabled} onClick={onClick}>{children}</button>,IconButton=Button;
export const ConversationRail=()=>null,ConversationScrollButton=()=>null;
`
async function bundle(mobile) {
  const mocks = {
    'fixture-projection': `export * from '@dovo/protocol';export {conversationMessages} from '${root}/apps/mobile/src/tasks/conversation/state/messages.ts';`,
    '@dovo/studio-core': `export * from '@dovo/protocol';export {useFixture as useWorkspace} from 'fixture';export const useStudioHost=()=>({});export const formatDateTime=()=>'';export const useAppPreferences=()=>({responseStreaming:'tokens'});export const completedStreamingText=text=>text;`,
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/studio-ui': ui,
    './use-conversation-history': `export const useConversationHistory=task=>({task,hasMore:false,busy:false,error:'',setBookmark:()=>{}});`,
    './use-thread-search': `export const useThreadSearch=()=>({matches:[],error:''});`,
    './deferred-turn': `export const DeferredTurn=({children})=>children();`,
    './task-activity': `import {useFixture} from 'fixture';export const useTaskActivity=()=>({tools:useFixture().tools,error:''});export const TaskActivity=({tools})=>tools.length?<div data-tools>Tools</div>:null;`,
    './pull-link-actions': `export const PullLinkActions=()=>null;`,
    './turn-label': `export const TurnLabel=({turn})=><span>{turn.status==='running'?'Working…':'Worked for 1m'}</span>;`,
    './state/provider': `import {useFixture} from 'fixture';export const useConversationSelector=select=>select(useFixture());export const useConversationPresentation=id=>useFixture().presentation.get(id);export const usePendingConversationMessage=()=>null;`,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/state/app-active': `export const useForegroundInterval=()=>{};`,
    '../../runtime/preferences/app-preferences': `export const useCarMode=()=>false;export const useMobilePreferences=()=>({});export const formatTime=()=>'';`,
    '../../runtime/connection/provider': `export const useRuntime=()=>({connected:true});`,
    '../../ui/theme': `export const styles={},colors={};`,
    '../../ui/content/text': `export {Text} from 'react-native';`,
    '../../ui/controls/icon': `export const Icon=()=>null;`,
    '../../ui/controls/icon-button': `export const IconButton=()=>null;`,
    '../../ui/controls/pill': `export const Pill=()=>null;`,
    '../../runtime/connection/connection-status': `export const ConnectionPill=()=>null;`,
    './components/thread-markdown': `export const ThreadMarkdown=({text})=><p data-prose>{text}</p>;`,
    './components/tool-activity-row': `export const ToolActivityRow=()=> <div data-tools>Tools</div>;export const ReasoningActivity=()=>null;`,
    './components/work-group': `export const ConversationWorkGroup=({children})=><div>{children}</div>;`,
    './components/activity': `export const TaskActivity=()=>null;`,
    '@assistant-ui/react-native': `
import {useContext} from 'react';import {MessageContext,useFixture} from 'fixture';
export const useAuiState=select=>{const fixture=useFixture(),message=useContext(MessageContext);return select({thread:{messages:fixture.messages},message})};
export const MessageByIndexProvider=({index,children})=><MessageContext.Provider value={useFixture().messages[index]}>{children}</MessageContext.Provider>;
const PartByIndex=({index,components})=>{const part=useContext(MessageContext).content[index];const C=part.type==='text'?components.Text:part.type==='tool-call'?components.tools.Fallback:components.data.by_name[part.name];return C?<C {...part}/>:null};
export const MessagePrimitive={Root:({children})=><div>{children}</div>,PartByIndex,Parts:({components})=>useContext(MessageContext).content.map((_,index)=><PartByIndex key={index} index={index} components={components}/>)};
export const ThreadPrimitive={Root:({children})=><div>{children}</div>};`,
    'react-native': `
export const View=({children})=><div>{children}</div>,Text=({children})=><span>{children}</span>;
export const Pressable=({children,onPress,accessibilityRole,accessibilityLabel,accessibilityState})=>accessibilityRole==='button'?<button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress}>{children}</button>:<div onClick={onPress}>{children}</div>;
export const ActivityIndicator=()=>null;
export const FlatList=({data,renderItem,keyExtractor,ListHeaderComponent,ListFooterComponent})=><div>{ListFooterComponent}{[...data].reverse().map(item=><div key={keyExtractor(item)}>{renderItem({item})}</div>)}{ListHeaderComponent}</div>;`,
  }
  for (const [path, name] of Object.entries({
    './turn-checkpoint': 'TurnCheckpoint',
    '../composer/message-attachments': 'MessageAttachments',
    './message-copy': 'MessageCopy',
    '../actions/run-in-terminal': 'RunInTerminal',
    '../actions/fork-turn': 'ForkTurn',
    '../actions/retry-turn': 'RetryTurn',
    './components/message-actions': 'MessageActions',
    './components/message-attachments': 'MessageAttachments',
    './components/checkpoint-files': 'CheckpointFiles',
    '../detail/approvals': 'TaskApprovals',
  }))
    mocks[path] = `export const ${name}=()=>null;`
  const result = await build({
    stdin: {
      contents: mobile
        ? `import {Conversation} from '${root}/apps/mobile/src/tasks/conversation/view.tsx';import {App} from 'fixture';createRoot(document.getElementById('app')).render(<App/>);import {createRoot} from 'react-dom/client';`
        : `import {App} from 'fixture';import {createRoot} from 'react-dom/client';createRoot(document.getElementById('app')).render(<App/>);`,
      resolveDir: root,
      loader: 'tsx',
    },
    alias: {
      react: `${root}/packages/studio-ui/node_modules/react`,
      'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    },
    nodePaths: [`${root}/packages/studio-ui/node_modules`],
    plugins: [
      {
        name: 'environment',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) || path === 'fixture'
              ? { path, namespace: 'mock' }
              : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents:
              path === 'fixture'
                ? fixture
                    .replace('CONTENT', mobile ? '<Conversation/>' : '<ChatThread task={task}/>')
                    .replace(
                      'export const Context=',
                      mobile
                        ? `import {Conversation} from '${root}/apps/mobile/src/tasks/conversation/view.tsx';export const Context=`
                        : `import {ChatThread} from '${root}/packages/extension-tasks/src/chat/thread/chat-thread.tsx';export const Context=`,
                    )
                : mocks[path],
            loader: 'tsx',
            resolveDir: `${root}/packages/studio-ui`,
          }))
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
  return result.outputFiles[0].text
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle(mobile) })
    const header = page.getByRole('button', { name: /Worked for/ })
    await header.waitFor()
    assert.equal(await header.count(), 1)
    assert.equal(
      await page.getByText('1 test command · 3 commands used', { exact: true }).count(),
      1,
    )
    assert.equal(
      await page
        .locator('[data-prose]')
        .allTextContents()
        .then((text) => text.join('|')),
      'Original request|Clarification|Final answer.',
    )
    assert.equal(await page.locator('[data-tools]').count(), 0)
    await header.click()
    assert.deepEqual(await page.locator('[data-prose]').allTextContents(), [
      'Original request',
      'First update.',
      'Second update.',
      'Clarification',
      'Linking works on right-click or long-press.',
      'Final answer.',
    ])
    const prose = page.getByText('Linking works on right-click or long-press.', { exact: true })
    assert.equal(await prose.count(), 1)
    assert.equal(await page.locator('[data-tools]').count(), 3)
    const order = await page.locator('[data-prose],[data-tools]').allTextContents()
    assert.ok(
      order.lastIndexOf('Tools') > order.indexOf('Linking works on right-click or long-press.'),
    )
    await header.click()
    assert.equal(await page.getByText('Final answer.', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Clarification', { exact: true }).count(), 1)
    await page.evaluate(() =>
      window.setTask((task) => ({
        ...task,
        status: 'running',
        turns: task.turns.map((turn) => ({ ...turn, status: 'running', finishedAt: undefined })),
      })),
    )
    const running = page.getByRole('button', { name: /Working/ })
    await running.waitFor()
    assert.equal(await running.count(), 1)
    await running.click()
    assert.equal(await page.getByText('First update.', { exact: true }).count(), 1)
    await page.evaluate(() =>
      window.setTask((task) => ({
        ...task,
        turns: task.turns.map((turn) => ({ ...turn, status: 'failed', error: 'Provider failed' })),
      })),
    )
    await page.getByRole('button', { name: 'Turn failed' }).waitFor()
    assert.equal(await page.getByText('Final answer.', { exact: true }).count(), 1)
    await page.evaluate(() =>
      window.setTask((task) => ({
        ...task,
        status: 'done',
        turns: task.turns.map((turn) => ({ ...turn, status: 'completed' })),
        messages: task.messages.map((message) =>
          message.id === 'after' ? { ...message, text: '' } : message,
        ),
      })),
    )
    const finished = page.getByRole('button', { name: /Worked for/ })
    await finished.waitFor()
    if ((await finished.getAttribute('aria-expanded')) === 'true') await finished.click()
    assert.equal(await page.getByText('First update.', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Second update.', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Clarification', { exact: true }).count(), 1)
    await page.evaluate(() => {
      window.events[2] = {
        ...window.events[2],
        payload: JSON.stringify({ ...JSON.parse(window.events[2].payload), status: 'failed' }),
      }
      window.setTask((task) => ({ ...task }))
    })
    await page.locator('[data-tools]').waitFor()
    assert.equal(await page.locator('[data-tools]').count(), 1)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Desktop and mobile: one logical turn, steering remains visible, separate provider messages, intact hyphenated prose, tool order, final reply retained and shared collapse state passed.',
  )
} finally {
  await browser.close()
}
