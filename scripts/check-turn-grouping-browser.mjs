import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

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
window.events=events;export function App(){const[connected,setConnected]=useState(true);window.setConnected=setConnected;const[historyBusy,setHistoryBusy]=useState(false);window.setHistoryBusy=setHistoryBusy;const[task,setTask]=useState(initial),[active,setActive]=useState(true),[collapsedTurns,setCollapsed]=useState({}),[preferences,setPreferences]=useState({toolActivity:'collapsed',showToolDetails:false,responseStreaming:'tokens'});window.setTask=setTask;window.setActive=setActive;window.setPreferences=setPreferences;window.fixturePreferences=preferences;const presentation=conversationPresentation(task);const messages=conversationMessages(task,events);const value={task,presentation,messages,events,childResultIds:new Set(task.messages.filter(message=>message.subagentResultId).map(message=>message.id)),tools:recentTools(events),preferences,collapsedTurns,toggleTurn:id=>setCollapsed(old=>({...old,[id]:!(old[id]??[...presentation.values()].find(value=>value.groupId===id)?.groupTurn?.status==='completed')})),workspace:{tasks:[task]},connection:{address:'http://copy.lan:8787',token:'copy-token'},connected,request:async()=>({ok:true}),history:{hasMore:false,busy:historyBusy,error:'',setBookmark:()=>{}},legacyEvents:[],activityError:'',followRequest:0,recentReady:true,onRecentLayout:()=>{window.recentLayouts=(window.recentLayouts??0)+1}};return <Context.Provider value={value}>CONTENT</Context.Provider>}
`
const ui = `export {cn} from './src/lib/utils';export {Dialog,DialogContent,DialogTitle} from '../studio-ui/src/components/ui/dialog';
export {FileTypeIcon} from './src/file-tree';export {RepositoryOpenItems} from './src/repository-open-items';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';
export * as ContextMenu from '@radix-ui/react-context-menu';export const Conversation=({children,...props})=><div {...props}>{children}</div>;
export const ConversationContent=({children})=><div>{children}</div>,ConversationHistory=ConversationContent;
export const Message=({children,id})=><div id={id}>{children}</div>,MessageContent=ConversationContent;
export const MessageResponse=({children})=>{(window.renderedProse??=[]).push(children);return <p data-prose>{children}</p>};
export const Button=({children,onClick,disabled,...props})=><button aria-expanded={props['aria-expanded']} disabled={disabled} onClick={onClick}>{children}</button>,IconButton=Button;
export const ConversationRail=()=>null,ConversationScrollButton=()=>null;
`
async function bundle(mobile) {
  const mocks = {
    './components/failed-task-retry': 'export const FailedTaskRetry=()=>null;',

    'fixture-projection': `export * from '@dovo/protocol';export {conversationMessages} from '${root}/apps/mobile/src/tasks/conversation/state/messages.ts';`,
    '@dovo/studio-core': `export const reducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;export * from '@dovo/protocol';export {startPolling,clientScopeKey} from '@dovo/client-runtime';import {useFixture} from 'fixture';export {useFixture as useWorkspace} from 'fixture';export const useStudioHost=()=>({});export const formatDateTime=()=>'';export const useAppPreferences=()=>({themePalette:'dovo',...useFixture().preferences});export const useResolvedTheme=()=> 'dark';export const readAppPreferences=()=>window.fixturePreferences;export const completedStreamingText=text=>text;`,
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
    '../../runtime/connection/provider': `import {useFixture} from 'fixture';export const useRuntime=()=>({connected:useFixture().connected});`,
    '../controls/icon': `export const Icon=({name})=><span data-file-icon={name}/>;`,
    '../theme': `export const useTheme=()=>({mode:'dark',colors:{},styles:{}});`,
    './text': `export {Text} from 'react-native';`,
    '../../ui/theme': `export const styles={},colors={};export const useTheme=()=>({styles,colors,mode:'dark'});`,
    '../../../ui/content/server-image': `export const ServerImage=({label})=><div data-image>{label}</div>;`,
    '../../ui/content/text': `export {Text} from 'react-native';`,
    '../../ui/controls/icon': `export const Icon=()=>null;`,
    '../../ui/controls/icon-button': `export const IconButton=()=>null;`,
    '../../ui/controls/pill': `export const Pill=()=>null;`,
    '../../ui/controls/action': `export const Action=()=>null;`,
    '../../runtime/connection/connection-status': `export const ConnectionPill=()=>null;`,
    '../../../ui/content/open-link': `export const openAppLink=async()=>{};`,
    '../../../ui/content/link-origin': `export const useLinkOrigin=()=>({});`,
    './components/thread-markdown': `export const ThreadMarkdown=({text})=>{(window.renderedProse??=[]).push(text);return <p data-prose>{text}</p>};`,
    './components/tool-activity-row': `import {ToolActivityRow as ActualToolActivityRow} from '${root}/apps/mobile/src/tasks/conversation/components/tool-activity-row.tsx';export const ToolActivityRow=props=>window.artifactCase?<ActualToolActivityRow {...props}/>:<div data-tools>Tools</div>;export const ReasoningActivity=()=>null;`,
    './components/work-group': `import {ConversationWorkGroup as ActualWorkGroup} from '${root}/apps/mobile/src/tasks/conversation/components/work-group.tsx';export const ConversationWorkGroup=props=>window.artifactCase?<ActualWorkGroup {...props}/>:<div>{props.children}</div>;`,
    './components/activity': `export const TaskActivity=()=>null;`,
    '@assistant-ui/react-native': `
import {useContext,useEffect} from 'react';import {MessageContext,useFixture} from 'fixture';
export const useAuiState=select=>{const fixture=useFixture(),message=useContext(MessageContext);return select({thread:{messages:fixture.messages},message})};
export const unstable_useThreadMessageIds=()=>useFixture().messages.map(message=>message.id);
const PartByIndex=({index,components})=>{const part=useContext(MessageContext).content[index];const C=part.type==='text'?components.Text:part.type==='tool-call'?components.tools.Fallback:components.data.by_name[part.name];return C?<C {...part}/>:null};
export const MessagePrimitive={Root:({children,onLayout})=>{useEffect(()=>onLayout?.(),[onLayout]);return <div>{children}</div>},PartByIndex,Parts:({components})=>useContext(MessageContext).content.map((_,index)=><PartByIndex key={index} index={index} components={components}/>)};
export const ThreadPrimitive={Root:({children})=><div>{children}</div>,Unstable_MessageById:({messageId,components})=>{
const message=useFixture().messages.find(message=>message.id===messageId);if(!message)return null;
const Component=components.Message;return <MessageContext.Provider value={message}><Component/></MessageContext.Provider>;
}};`,
    'react-native': `
import {useEffect} from 'react';
export const View=({children,style,accessibilityRole,accessibilityLabel})=><div style={style} role={accessibilityRole==='image'?'img':undefined} aria-label={accessibilityLabel}>{children}</div>,Text=({children,style})=><span style={Array.isArray(style)?Object.assign({},...style):style}>{children}</span>;export const SectionList=()=>null;export const ScrollView=View;
export const Pressable=({children,onPress,accessibilityRole,accessibilityLabel,accessibilityState})=>accessibilityRole==='button'?<button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button>:<div onClick={onPress}>{children}</div>;
export const Alert={alert:message=>{throw Error(message)}};export const ActivityIndicator=()=> <span data-loading-history style={{display:"block",width:20,height:20}}/>;
export const FlatList=({data,renderItem,keyExtractor,ListHeaderComponent,ListFooterComponent,onLayout,contentContainerStyle,onScrollBeginDrag,onScrollEndDrag})=>{window.readEarlier=()=>{onScrollBeginDrag();onScrollEndDrag({nativeEvent:{contentOffset:{y:500},velocity:{y:0}}})};const padding=Object.assign({},...contentContainerStyle);useEffect(()=>onLayout?.({nativeEvent:{layout:{height:500}}}),[onLayout]);return <div data-conversation-list style={{display:'flex',flexDirection:'column-reverse',paddingTop:padding.paddingTop,paddingBottom:padding.paddingBottom}}>{ListHeaderComponent}{data.map(item=><div key={keyExtractor(item)}>{renderItem({item})}</div>)}{ListFooterComponent}</div>};`,
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
                    .replace(
                      'CONTENT',
                      mobile ? '<Conversation/>' : '<ChatThread task={task} active={active}/>',
                    )
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
const visualText = (locator) =>
  locator.evaluateAll((elements) =>
    elements
      .map((element) => ({ text: element.textContent, top: element.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .map(({ text }) => text),
  )
const visualIndices = (locator) =>
  locator.evaluateAll((elements) =>
    elements
      .map((element, index) => ({ index, top: element.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .map(({ index }) => index),
  )
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(
      '<style>.flex{display:flex}.flex-col{flex-direction:column}.flex-col-reverse{flex-direction:column-reverse}.gap-3{gap:12px}.gap-5{gap:20px}</style><div id="app"></div>',
    )
    await page.addScriptTag({ content: await bundle(mobile) })
    const header = page.getByRole('button', { name: /Worked for/ })
    await header.waitFor()
    assert.equal(await page.getByText('Response', { exact: true }).count(), 0)
    if (mobile) assert.equal(await page.evaluate(() => window.recentLayouts), 1)
    if (mobile) {
      const list = page.locator('[data-conversation-list]')
      const before = await list.boundingBox()
      await page.evaluate(() => window.setConnected(false))
      await page.evaluate(() => new Promise(requestAnimationFrame))
      assert.deepEqual(
        await list.boundingBox(),
        before,
        'A connection status change does not shift conversation content',
      )
      await page.evaluate(() => {
        window.setConnected(true)
        window.readEarlier()
      })
      await page.evaluate(() => new Promise(requestAnimationFrame))
      assert.deepEqual(
        await list.boundingBox(),
        before,
        'Reading history does not change the conversation padding',
      )
      await page.evaluate(() => window.setHistoryBusy(true))
      await page.locator('[data-loading-history]').waitFor()
      assert.deepEqual(
        await list.boundingBox(),
        before,
        'Loading earlier messages reserves its indicator space',
      )
      await page.evaluate(() => window.setHistoryBusy(false))
      await page.locator('[data-loading-history]').waitFor({ state: 'detached' })
    }
    const fallback = page.getByText('Scope found no matching project; continued in General.', {
      exact: true,
    })
    assert.equal(await fallback.count(), 0)
    await page.evaluate(() => window.setTask((task) => ({ ...task, autoProjectFallback: true })))
    await fallback.waitFor()
    await page.evaluate(() => window.setTask((task) => ({ ...task })))
    assert.equal(await fallback.count(), 1)
    await page.evaluate(() =>
      window.setTask((task) => ({ ...task, autoProjectFallback: undefined })),
    )
    await fallback.waitFor({ state: 'detached' })
    assert.equal(
      await page.evaluate(() => window.renderedProse[0]),
      mobile ? 'Final answer.' : 'Original request',
    )
    assert.equal(await header.count(), 1)
    assert.equal(
      await page.getByText('1 test command · 3 commands used', { exact: true }).count(),
      1,
    )
    assert.equal(
      (await visualText(page.locator('[data-prose]'))).join('|'),
      'Original request|Clarification|Final answer.',
    )
    if (!mobile) {
      const selected = await page.evaluate(() => {
        const prose = [...document.querySelectorAll('[data-prose]')]
        const range = document.createRange()
        range.setStartBefore(prose[0])
        range.setEndAfter(prose.at(-1))
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        const text = selection.toString()
        selection.removeAllRanges()
        return text
      })
      assert.ok(selected.indexOf('Original request') < selected.indexOf('Clarification'))
      assert.ok(selected.indexOf('Clarification') < selected.indexOf('Final answer.'))
    }
    assert.equal(await page.locator('[data-tools]').count(), 0)
    await header.click()
    assert.deepEqual(await visualText(page.locator('[data-prose]')), [
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
    const order = await visualText(page.locator('[data-prose],[data-tools]'))
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
      window.renderedProse = []
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
    assert.equal(
      await page.evaluate(() => window.renderedProse[0]),
      mobile ? 'Independent answer' : 'First request',
    )
    const disclosures = page.getByRole('button', { name: /Worked for/ })
    assert.equal(await disclosures.count(), 2)
    for (let index = 0; index < 2; index++) {
      if ((await disclosures.nth(index).getAttribute('aria-expanded')) === 'true')
        await disclosures.nth(index).click()
    }
    assert.deepEqual(await visualText(page.locator('[data-prose]')), [
      'First request',
      'Resume clarification',
      'Resumed answer',
      'Second request',
      'Independent answer',
    ])
    const [firstIndex, secondIndex] = await visualIndices(disclosures)
    await disclosures.nth(firstIndex).click()
    assert.equal(await page.getByText('Initial execution', { exact: true }).count(), 1)
    assert.equal(await disclosures.nth(secondIndex).getAttribute('aria-expanded'), 'false')
    await disclosures.nth(firstIndex).click()
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
    await page.getByRole('button', { name: 'Open artifact Preview 2', exact: true }).click()
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
    if (mobile) {
      await page.evaluate(() => {
        window.setPreferences((value) => ({ ...value, collapseChangedFiles: true }))
        window.setTask((task) => ({
          ...task,
          turns: task.turns.map((turn) => ({
            ...turn,
            checkpoint: {
              before: 'before',
              after: 'after',
              files: [
                'src/index.ts',
                'tests/index.test.ts',
                '__mocks__/api.ts',
                'docs/guide.md',
              ].map((path) => ({ path, before: '', after: 'change', viewed: false })),
              omitted: ['pnpm-lock.yaml'],
              linked: [
                {
                  checkoutId: 'linked',
                  repositoryId: 'other',
                  repositoryName: 'Other project',
                  directory: '/other',
                  before: 'before',
                  after: 'after',
                  files: ['src/index.ts', 'docs/guide.md'].map((path) => ({
                    path,
                    before: '',
                    after: 'change',
                    viewed: false,
                  })),
                  omitted: [],
                },
              ],
            },
          })),
        }))
      })
      for (const name of ['All 7', 'Code 2', 'Tests 1', 'Mocks 1', 'Docs 2', 'Generated 1'])
        await page.getByRole('button', { name, exact: true }).waitFor()
      assert.equal(
        await page
          .getByRole('button', { name: 'Turn changes · 7 files', exact: true })
          .getAttribute('aria-expanded'),
        'false',
      )
      await page.getByRole('button', { name: 'Tests 1', exact: true }).click()
      assert.equal(
        await page
          .getByRole('button', { name: 'Tests 1', exact: true })
          .getAttribute('aria-pressed'),
        'true',
      )
      assert.equal(
        await page
          .getByRole('button', { name: 'Turn changes · 7 files', exact: true })
          .getAttribute('aria-expanded'),
        'true',
      )
      await page.getByRole('button', { name: 'tests', exact: true }).click()
      const testFile = page.getByRole('button', { name: 'tests/index.test.ts', exact: true })
      await testFile.waitFor()
      assert.equal(await testFile.locator('[role=img][aria-label=Tests]').count(), 1)
      assert.equal(await testFile.locator('[data-file-icon]').count(), 1)
      assert.equal(await page.getByRole('button', { name: 'src', exact: true }).count(), 0)
      const docs = page.getByRole('button', { name: 'Docs 2', exact: true })
      await docs.click()
      assert.equal(
        await page.getByRole('button', { name: 'docs', exact: true }).count(),
        2,
        'Both checkouts retain their matching docs',
      )
      await docs.click()
      assert.equal(await docs.getAttribute('aria-pressed'), 'false')
      await page.getByRole('button', { name: 'Generated 1', exact: true }).click()
      await page.getByRole('button', { name: 'pnpm-lock.yaml', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'src', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'All 7', exact: true }).click()
      await page.evaluate(() =>
        window.setTask((task) => ({
          ...task,
          turns: task.turns.map((turn) => ({
            ...turn,
            checkpoint: {
              before: 'before',
              after: 'after',
              files: [{ path: 'README.md', before: '', after: 'Docs', viewed: false }],
              omitted: [],
            },
          })),
        })),
      )
      await page.getByText('Docs 1', { exact: true }).waitFor()
      // An empty recent window must still allow older history to load after list layout.
      await page.evaluate(() => {
        window.recentLayouts = 0
        window.setTask((task) => ({ ...task, id: 'empty', messages: [], turns: [] }))
      })
      await page.waitForFunction(() => window.recentLayouts === 1)
    }
    if (!mobile) {
      // Exercise the actual copy menu, authenticated history request and cancellation.
      await page.evaluate(() => {
        window.artifactCase = false
        window.events.length = 0
        window.copies = []
        window.copyRequests = []
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (text) => window.copies.push(text) },
        })
        window.copyMode = 'good'
        window.fetch = async (url, init) => {
          if (new URL(url).pathname !== '/api/tasks/history' || init.method !== 'POST')
            throw new Error('Invalid copy history request')
          if (new Headers(init.headers).get('Authorization') !== 'Bearer copy-token')
            throw new Error('Unauthenticated copy request')
          const input = JSON.parse(init.body)
          window.copyRequests.push(input)
          if (window.copyMode === 'pending') {
            window.copySignal = init.signal
            return new Promise(
              (resolve) =>
                (window.finishCopyRead = () =>
                  resolve(Response.json({ messages: [], turns: [], historyRevision: 3 }))),
            )
          }
          return Response.json({
            messages: [{ id: 'old', role: 'user', text: 'Older request' }],
            turns: [],
            historyRevision: window.copyMode === 'revision' ? 4 : 3,
            ...(window.copyMode === 'cursor' ? { before: input.before } : {}),
          })
        }
        window.setTask((task) => ({
          ...task,
          id: 'copy-thread',
          historyBefore: 'recent',
          historyRevision: 3,
          messages: [{ id: 'recent', role: 'assistant', text: 'Newest copy reply' }],
          turns: [],
        }))
      })
      // The fixture's connection is read by ChatThread through useWorkspace.
      const copy = async () => {
        await page.locator('#message-copy-thread-recent').click({ button: 'right' })
        await page.getByText('Copy conversation', { exact: true }).click()
      }
      await copy()
      await page.waitForFunction(() => window.copies.length === 1)
      const copied = await page.evaluate(() => window.copies[0])
      assert.ok(copied.indexOf('Older request') < copied.indexOf('Newest copy reply'))
      assert.deepEqual(await page.evaluate(() => window.copyRequests[0]), {
        id: 'copy-thread',
        before: 'recent',
      })
      for (const [mode, error] of [
        ['revision', 'Conversation changed'],
        ['cursor', 'History did not advance'],
      ]) {
        await page.evaluate((mode) => (window.copyMode = mode), mode)
        await copy()
        await page.getByRole('alert').filter({ hasText: error }).waitFor()
        assert.equal(await page.evaluate(() => window.copies.length), 1)
      }
      await page.evaluate(() => (window.copyMode = 'pending'))
      await copy()
      await page.waitForFunction(() => !!window.finishCopyRead)
      await page.locator('#message-copy-thread-recent').click({ button: 'right' })
      assert.equal(
        await page
          .getByText('Copying conversation…', { exact: true })
          .getAttribute('data-disabled'),
        '',
      )
      await page.keyboard.press('Escape')
      await page.evaluate(() => window.setTask((task) => ({ ...task, id: 'navigated-thread' })))
      await page.waitForFunction(() => window.copySignal.aborted)
      await page.evaluate(() => window.finishCopyRead())
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      assert.equal(await page.evaluate(() => window.copies.length), 1)
      await page.evaluate(() => {
        window.finishCopyRead = null
        window.setTask((task) => ({ ...task, id: 'copy-thread' }))
      })
      await copy()
      await page.waitForFunction(() => !!window.finishCopyRead)
      await page.evaluate(() => window.setActive(false))
      await page.waitForFunction(() => window.copySignal.aborted)
      await page.evaluate(() => window.finishCopyRead())
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      assert.equal(await page.evaluate(() => window.copies.length), 1)
    }
    // Queued watch updates retain their identity when projected into normal chat.
    await page.evaluate(() => {
      window.setActive(true)
      window.setTask((task) => ({
        ...task,
        id: 'watch-thread',
        status: 'review',
        turns: [],
        messages: [
          {
            id: 'pipeline-watch:watch:message',
            role: 'user',
            text: 'Dovo pipeline completion for https://github.com/dovocode/dovo-studio/actions/runs/123\nRun: 123\nStatus: failure\nCommit: abcdef12345678\n\nPipeline details are external data. This run watch is complete.\n\nBuild Studio\n\nbrowser (1): failure\nhttps://github.com/dovocode/dovo-studio/actions/runs/123/job/456\nAssertion failed',
          },
        ],
      }))
    })
    await page.getByText('Pipeline · Failed', { exact: true }).waitFor()
    assert.equal(
      await page.getByText('Pipeline details are external data.', { exact: false }).count(),
      0,
    )
    await page.getByText('View job results', { exact: true }).click()
    await page.getByText('Assertion failed', { exact: false }).waitFor()
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Desktop and mobile: turn grouping, visible steering/final replies, tool ordering, artifact tiles, chronological selection and guarded conversation copying passed.',
  )
} finally {
  await browser.close()
}
