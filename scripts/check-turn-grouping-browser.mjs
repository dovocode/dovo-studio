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
window.events=events;export function App(){const[task,setTask]=useState(initial),[collapsedTurns,setCollapsed]=useState({}),[preferences,setPreferences]=useState({toolActivity:'collapsed',showToolDetails:false,responseStreaming:'tokens'});window.setTask=setTask;window.setPreferences=setPreferences;window.fixturePreferences=preferences;const presentation=conversationPresentation(task);const messages=conversationMessages(task,events);const value={task,presentation,messages,events,tools:recentTools(events),preferences,collapsedTurns,toggleTurn:id=>setCollapsed(old=>({...old,[id]:!(old[id]??[...presentation.values()].find(value=>value.groupId===id)?.groupTurn?.status==='completed')})),workspace:{tasks:[task]},connected:true,request:async()=>({ok:true}),history:{hasMore:false,busy:false,error:'',setBookmark:()=>{}},legacyEvents:[],activityError:'',followRequest:0};return <Context.Provider value={value}>CONTENT</Context.Provider>}
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
    '@dovo/studio-core': `export * from '@dovo/protocol';export {startPolling,clientScopeKey} from '@dovo/client-runtime';import {useFixture} from 'fixture';export {useFixture as useWorkspace} from 'fixture';export const useStudioHost=()=>({});export const formatDateTime=()=>'';export const useAppPreferences=()=>useFixture().preferences;export const readAppPreferences=()=>window.fixturePreferences;export const completedStreamingText=text=>text;`,
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/studio-ui': ui,
    './use-conversation-history': `export const useConversationHistory=task=>({task,hasMore:false,busy:false,error:'',setBookmark:()=>{}});`,
    './use-thread-search': `export const useThreadSearch=()=>({matches:[],error:''});`,
    './deferred-turn': `export const DeferredTurn=({children})=>children();`,
    './task-activity': `import {useFixture} from 'fixture';import {TaskActivity as ActualTaskActivity} from '${root}/packages/extension-tasks/src/chat/thread/task-activity.tsx';export const useTaskActivity=()=>({tools:useFixture().tools,error:''});export const TaskActivity=props=>window.artifactCase?<ActualTaskActivity {...props}/>:props.tools.length?<div data-tools>Tools</div>:null;`,
    './pull-link-actions': `export const PullLinkActions=()=>null;`,
    './turn-label': `export const TurnLabel=({turn})=><span>{turn.status==='running'?'Working…':'Worked for 1m'}</span>;`,
    './state/provider': `import {useFixture} from 'fixture';export const useConversationSelector=select=>select(useFixture());export const useConversationPresentation=id=>useFixture().presentation.get(id);export const usePendingConversationMessage=()=>null;`,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/state/app-active': `export const useForegroundInterval=()=>{};`,
    '../../runtime/preferences/app-preferences': `import {useFixture} from 'fixture';export const useCarMode=()=>false;export const useMobilePreferences=()=>useFixture().preferences;export const formatTime=()=>'';`,
    '../../runtime/connection/provider': `export const useRuntime=()=>({connected:true});`,
    '../../ui/theme': `export const styles={},colors={};export const useTheme=()=>({styles,colors,mode:'dark'});`,
    '../../../ui/content/server-image': `export const ServerImage=({label})=><div data-image>{label}</div>;`,
    '../../ui/content/text': `export {Text} from 'react-native';`,
    '../../ui/controls/icon': `export const Icon=()=>null;`,
    '../../ui/controls/icon-button': `export const IconButton=()=>null;`,
    '../../ui/controls/pill': `export const Pill=()=>null;`,
    '../../ui/controls/action': `export const Action=()=>null;`,
    '../../runtime/connection/connection-status': `export const ConnectionPill=()=>null;`,
    './components/thread-markdown': `export const ThreadMarkdown=({text})=><p data-prose>{text}</p>;`,
    './components/tool-activity-row': `import {ToolActivityRow as ActualToolActivityRow} from '${root}/apps/mobile/src/tasks/conversation/components/tool-activity-row.tsx';export const ToolActivityRow=props=>window.artifactCase?<ActualToolActivityRow {...props}/>:<div data-tools>Tools</div>;export const ReasoningActivity=()=>null;`,
    './components/work-group': `import {ConversationWorkGroup as ActualWorkGroup} from '${root}/apps/mobile/src/tasks/conversation/components/work-group.tsx';export const ConversationWorkGroup=props=>window.artifactCase?<ActualWorkGroup {...props}/>:<div>{props.children}</div>;`,
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
  mocks['../state/provider'] =
    `import {useFixture} from 'fixture';export const useConversationTurn=id=>useFixture().presentation.get(id)?.turn;`
  for (const path of [
    '../../../runtime/preferences/app-preferences',
    '../../../runtime/state/application-state',
    '../../../ui/content/text',
    '../../../ui/theme',
    '../../../ui/controls/icon',
  ])
    mocks[path] = mocks[path.replace('../../../', '../../')]
  mocks['./thread-markdown'] = mocks['./components/thread-markdown']
  for (const path of ['../artifacts', '../../../ui/content/artifacts'])
    mocks[path] =
      `export const ArtifactCard=({reference})=><button aria-label={'Open artifact '+reference.title} onClick={()=>window.openedArtifact=reference}>{reference.title}</button>;`
  for (const path of ['../mcp-app', '../../../ui/content/mcp-app'])
    mocks[path] = `export const McpAppView=()=>null;`
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
      '@dovo/client-runtime': `${root}/packages/client-runtime/src/index.ts`,
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
    // Resumed executions share a disclosure; the next independent request gets its own.
    await page.evaluate(() => {
      window.events.length = 0
      window.setTask((task) => ({
        ...task,
        messages: [
          { id: 'request', role: 'user', text: 'First request' },
          { id: 'before', turnId: 'attempt', role: 'assistant', text: 'Initial execution' },
          { id: 'steer', turnId: 'resume', role: 'user', text: 'Resume clarification' },
          { id: 'after', turnId: 'resume', role: 'assistant', text: 'Resumed answer' },
          { id: 'next-request', role: 'user', text: 'Second request' },
          { id: 'next-answer', turnId: 'next', role: 'assistant', text: 'Independent answer' },
        ],
        turns: [
          { ...task.turns[0], id: 'attempt', runId: 'run', assistantId: 'before' },
          { ...task.turns[0], id: 'resume', runId: 'run', assistantId: 'after' },
          { ...task.turns[0], id: 'next', runId: 'next-run', assistantId: 'next-answer' },
        ],
      }))
    })
    await page.getByText('Independent answer', { exact: true }).waitFor()
    const disclosures = page.getByRole('button', { name: /Worked for/ })
    assert.equal(await disclosures.count(), 2)
    for (let index = 0; index < 2; index++) {
      if ((await disclosures.nth(index).getAttribute('aria-expanded')) === 'true')
        await disclosures.nth(index).click()
    }
    assert.deepEqual(await page.locator('[data-prose]').allTextContents(), [
      'First request',
      'Resume clarification',
      'Resumed answer',
      'Second request',
      'Independent answer',
    ])
    await disclosures.first().click()
    assert.equal(await page.getByText('Initial execution', { exact: true }).count(), 1)
    assert.equal(await disclosures.nth(1).getAttribute('aria-expanded'), 'false')
    await disclosures.first().click()
    assert.equal(await page.getByText('Initial execution', { exact: true }).count(), 0)

    // Artifact-bearing messages survive the outer disclosure, including a middle reply
    // that owns neither the turn header nor its final answer/footer.
    await page.evaluate(() => {
      window.artifactCase = true
      window.events.length = 0
      window.setTask((task) => ({
        ...task,
        messages: [
          { id: 'request', turnId: 'attempt', role: 'user', text: 'Create previews' },
          { id: 'before', turnId: 'attempt', role: 'assistant', text: 'Starting work' },
          { id: 'steer', turnId: 'attempt', role: 'user', text: 'Use this direction' },
          { id: 'middle', turnId: 'attempt', role: 'assistant', text: 'Building previews' },
          { id: 'steer-again', turnId: 'attempt', role: 'user', text: 'Finish it' },
          { id: 'after', turnId: 'attempt', role: 'assistant', text: 'Previews ready' },
        ],
        turns: [{ ...task.turns[0], assistantId: 'after' }],
      }))
    })
    await page.getByText('Previews ready', { exact: true }).waitFor()
    const artifactTurn = page.getByRole('button', { name: /Worked for/ })
    await artifactTurn.waitFor()
    if ((await artifactTurn.getAttribute('aria-expanded')) === 'true') await artifactTurn.click()
    assert.equal(await page.getByRole('button', { name: /^Open artifact / }).count(), 0)
    await page.evaluate(() => {
      for (const [index, messageId] of ['before', 'middle'].entries()) {
        const id = `b43c4ca3-d5cd-40cd-b98c-cfba9b02e40${index}`
        window.events.push({
          id: `artifact:${id}:1`,
          scope: 'thread',
          kind: 'tool',
          time: '2026-10-03T10:00:20Z',
          summary: 'Artifact created',
          payload: JSON.stringify({
            turnId: 'attempt',
            messageId,
            toolId: `artifact:${id}:1`,
            status: 'completed',
            textOffset: 0,
            artifacts: [
              { id, taskId: 'thread', title: `Preview ${index + 1}`, format: 'html', revision: 1 },
            ],
          }),
        })
      }
      window.setTask((task) => ({ ...task }))
    })
    const tiles = page.getByRole('button', { name: /^Open artifact / })
    await page.getByRole('button', { name: 'Open artifact Preview 2' }).waitFor()
    assert.equal(await tiles.count(), 2)
    assert.equal(await page.getByText('Building previews', { exact: true }).count(), 0)
    for (const toolActivity of ['expanded', 'hidden', 'collapsed']) {
      await page.evaluate(
        (toolActivity) => window.setPreferences((value) => ({ ...value, toolActivity })),
        toolActivity,
      )
      assert.equal(await tiles.count(), 2)
      assert.equal(await page.locator('[aria-label="Task tool activity"]').count(), 0)
      assert.equal(
        await page.getByRole('button', { name: /tools? used|commands used/ }).count(),
        0,
        'Artifact tiles must not expose folded work details',
      )
      await artifactTurn.click()
      await page.getByText('Building previews', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Open artifact Preview 2' }).waitFor()
      assert.equal(await tiles.count(), 2, 'Expanding work must not duplicate artifacts')
      await artifactTurn.click()
      await page.getByRole('button', { name: 'Open artifact Preview 2' }).waitFor()
      assert.equal(await tiles.count(), 2)
    }
    await tiles.nth(1).click()
    assert.equal(await page.evaluate(() => window.openedArtifact.title), 'Preview 2')
    await page.evaluate(() =>
      window.setTask((task) => ({
        ...task,
        status: 'running',
        turns: task.turns.map((turn) => ({ ...turn, status: 'running', finishedAt: undefined })),
      })),
    )
    await page.getByRole('button', { name: /Working/ }).waitFor()
    assert.equal(await tiles.count(), 2, 'Manually folded running turns retain artifacts')
    await page.evaluate(() =>
      window.setTask((task) => ({
        ...task,
        status: 'done',
        messages: task.messages.map((message) =>
          message.role === 'assistant' ? { ...message, text: '' } : message,
        ),
        turns: task.turns.map((turn) => ({
          ...turn,
          status: 'completed',
          finishedAt: '2026-10-03T10:01:00Z',
        })),
      })),
    )
    await artifactTurn.waitFor()
    assert.equal(await tiles.count(), 2, 'Textless completed turns retain artifact tiles')
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Desktop and mobile: turn grouping, visible steering/final replies, tool ordering, and artifact tiles in folded, running, textless and intermediate replies across all tool activity settings passed.',
  )
} finally {
  await browser.close()
}
