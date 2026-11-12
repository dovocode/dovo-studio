import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const view = root + 'apps/mobile/src/tasks/conversation/view.tsx'
const imports = [
  ...(await readFile(view, 'utf8')).matchAll(/import\s*{([^}]+)}\s*from\s*'([^']+)'/gs),
]
const special = {
  './state/provider': `export const useConversationSelector=select=>select(window.conversation);export const usePendingConversationMessage=()=>null;export const useConversationPresentation=()=>null;`,
  '../../runtime/preferences/app-preferences': `export const useCarMode=()=>false;export const useMobilePreferences=()=>({});export const formatTime=()=>'';`,
  '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
  '../../ui/theme': `export const useTheme=()=>({colors:{},styles:{},reduceMotion:true});`,
  '../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../../ui/content/text': `export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;`,
  '../../notifications/viewport-view': `import {createContext} from 'react';export const NotificationViewportContext=createContext(null);`,
}
const stubs = imports
  .filter(
    ([, , path]) =>
      path.startsWith('.') &&
      !['./message-reveal', './state/scroll', '../../notifications/viewport'].includes(path),
  )
  .map(([, names, path]) => ({
    path,
    importer: view,
    contents:
      special[path] ??
      names
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name && !name.startsWith('type '))
        .map((name) => `export const ${name}=()=>null;`)
        .join('\n'),
  }))
stubs.push({
  path: '../../../runtime/connection/provider',
  importer: root + 'apps/mobile/src/tasks/conversation/state/use-conversation-history.ts',
  contents: `export const useRuntime=()=>window.runtime;export const useRuntimeSelector=select=>select(window.runtime);export const sameRuntimeFields=()=>true;`,
})
stubs.push({
  path: '@assistant-ui/react-native',
  contents: `import {useMemo} from 'react';const Box=({children})=><div>{children}</div>;export const ThreadPrimitive={Root:Box,Unstable_MessageById:({messageId})=><div>{messageId}</div>};export const MessagePrimitive={};export const useAuiState=()=>null;export const unstable_useThreadMessageIds=()=>useMemo(()=>window.conversation.task.messages.map(message=>message.id),[window.conversation.task.messages]);`,
})
stubs.push({
  path: 'react-native',
  contents: `
import {useImperativeHandle,useRef,useLayoutEffect} from 'react';export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};
export function View({children,ref,onLayout}){useImperativeHandle(ref,()=>({measureInWindow:callback=>callback(0,0,390,700)}),[]);useLayoutEffect(()=>{onLayout?.({nativeEvent:{layout:{height:700}}})},[]);return <div>{children}</div>}
export const ScrollView=View;export const Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;export const ActivityIndicator=()=>null;
export function FlatList({data,renderItem,ref,ListFooterComponent,ListHeaderComponent,onLayout}){useImperativeHandle(ref,()=>({scrollToIndex:({index})=>window.scrolled.push(data[index]),scrollToOffset:()=>{}}),[data]);useLayoutEffect(()=>{onLayout?.({nativeEvent:{layout:{height:700}}})},[]);return <div>{ListHeaderComponent}{data.map(item=><div key={item}>{renderItem({item})}</div>)}{ListFooterComponent}</div>}
`,
})
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Conversation} from './apps/mobile/src/tasks/conversation/view';import {useConversationHistory} from './apps/mobile/src/tasks/conversation/state/use-conversation-history';import {requestMessageReveal} from './apps/mobile/src/tasks/conversation/message-reveal';
window.scrolled=[];window.pages=[];
const connections={a:{address:'http://a.lan',token:'first'},b:{address:'http://b.lan',token:'second'}};
const live={id:'child',status:'review',messages:[{id:'m6',role:'assistant',text:'new'}],turns:[],historyBefore:'m6',historyRevision:1};
function App(){const[owner,setOwner]=useState('a'),[connected,setConnected]=useState(true),[failure,setFailure]=useState(false);window.setOwner=setOwner;window.setConnected=setConnected;window.setFailure=setFailure;window.seek=(id,host=owner)=>requestMessageReveal(connections[host],'child',id);window.runtime={profile:{connection:connections[owner]},connection:connections[owner],connected,activeId:owner,snapshot:{workspace:{repositories:[]}},readCache:null,read:async(_,{before})=>{window.pages.push(owner+':'+before);if(failure)throw new Error('Page unavailable');const end=Number(before.slice(1));const start=Math.max(0,end-2);return {messages:Array.from({length:end-start},(_,i)=>({id:'m'+(start+i),role:'assistant',text:'old'})),turns:[],before:start?'m'+start:undefined,historyRevision:1}}};const history=useConversationHistory(live,true);window.conversation={history,task:history.task,legacyEvents:[],visible:true,followRequest:0,recentReady:true,onRecentLayout:()=>{}};return <Conversation/>}createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'apps/mobile/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  },
  stubs,
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(5000)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.seek)
  await page.evaluate(() => window.seek('m0'))
  await page.waitForFunction(() => window.scrolled.includes('m0'))
  assert.deepEqual(await page.evaluate(() => window.pages), ['a:m6', 'a:m4', 'a:m2'])
  await page.evaluate(() => {
    window.scrolled = []
    window.seek('m3', 'b')
  })
  await page.waitForTimeout(50)
  assert.deepEqual(
    await page.evaluate(() => window.scrolled),
    [],
    'A target from another computer must not move this thread',
  )
  await page.evaluate(() => window.setOwner('b'))
  await page.waitForFunction(() => window.scrolled.includes('m3'))
  await page.evaluate(() => {
    window.setOwner('a')
    window.setFailure(true)
    window.scrolled = []
  })
  await page.evaluate(() => window.seek('m0'))
  await page.getByRole('alert').filter({ hasText: 'Page unavailable' }).waitFor()
  assert.equal(await page.evaluate(() => window.scrolled.includes('m0')), false)
  await page.evaluate(() => {
    window.setFailure(false)
  })
  await page.evaluate(() => window.seek('m0'))
  await page.waitForFunction(() => window.scrolled.includes('m0'))
  await page.evaluate(() => window.seek('missing'))
  await page
    .getByRole('alert')
    .filter({ hasText: 'This message is no longer available.' })
    .waitFor()
  await page.evaluate(() => {
    window.setConnected(false)
    window.seek('offline-message')
  })
  await page.getByRole('alert').filter({ hasText: 'Reconnect this computer' }).waitFor()
  assert.deepEqual(errors, [])
  await page.close()
} finally {
  await browser.close()
}
console.log(
  'Mobile conversation seeks exact messages across older pages, waits for the owning computer, and reports missing/offline targets. React Native primitives and transport are mocked.',
)
