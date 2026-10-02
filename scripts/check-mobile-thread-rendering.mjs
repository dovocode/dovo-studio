import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const mobileRequire = createRequire(new URL('../apps/mobile/package.json', import.meta.url))
const coreRequire = createRequire(mobileRequire.resolve('@assistant-ui/core/react'))
const webRequire = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const built = await build({
  alias: {
    '@assistant-ui/core/react': mobileRequire.resolve('@assistant-ui/core/react'),
    '@assistant-ui/store': coreRequire.resolve('@assistant-ui/store'),
    '@assistant-ui/store/client': coreRequire.resolve('@assistant-ui/store/client'),
    '@assistant-ui/store/internal': coreRequire.resolve('@assistant-ui/store/internal'),
    react: dirname(webRequire.resolve('react/package.json')),
  },
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { useState, useEffect, useMemo, memo } from 'react';
import { useExternalStoreRuntime, AssistantRuntimeProvider, MessageByIndexProvider } from '@assistant-ui/core/react';
import { useAuiState } from '@assistant-ui/store';
import { createConversationMessages, convertConversationMessage } from '../../apps/mobile/src/tasks/conversation/state/messages.ts';
const initial = {
  id:'large-thread', status:'running', messages:Array.from({length:500},(_,index)=>({id:String(index),role:index%2?'assistant':'user',text:'Message '+index})), turns:[], compactions:[],
};
window.messageRenders = Array(500).fill(0);
function Message() {
  const message = useAuiState(state=>state.message);
  window.messageRenders[Number(message.id)]++;
  return <p>{message.content[0].text}</p>;
}
const Cell = memo(({index})=><MessageByIndexProvider index={index}><Message/></MessageByIndexProvider>);
const cells=initial.messages.map((message,index)=><Cell key={message.id} index={index}/>);
function App() {
  const [revision, setRevision] = useState(0);
  const [text, setText] = useState('');
  const [project] = useState(createConversationMessages);
  const messages = useMemo(()=>project({...initial, messages:initial.messages.map((message,index)=>index===499?{...message,text:message.text+text}:message)},[]),[project,text]);
  const runtime = useExternalStoreRuntime({messages,convertMessage:convertConversationMessage,isRunning:false,onNew:async()=>{}});
  useEffect(()=>{
    window.runtime=runtime;
    window.revision=revision;
    window.text=text;
    window.edit=()=>setRevision(value=>value+1);
    window.stream=()=>setText(value=>value+'x');
  });
  return <AssistantRuntimeProvider runtime={runtime}><div>Draft revision {revision}</div>{cells}</AssistantRuntimeProvider>;
}
createRoot(document.getElementById('app')).render(<App/>);
`,
    resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  jsx: 'automatic',
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.error(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.runtime?.thread.getState().messages.length === 500)
  await page.evaluate(() => {
    window.initialMessages = window.runtime.thread.getState().messages
  })
  for (let revision = 1; revision <= 20; revision++) {
    await page.evaluate(() => window.edit())
    await page.waitForFunction((revision) => window.revision === revision, revision)
  }
  const unchanged = await page.evaluate(() =>
    window.runtime.thread
      .getState()
      .messages.every((message, index) => message === window.initialMessages[index]),
  )
  if (!unchanged) throw new Error('Typing invalidated historical messages')
  const renderedWhileTyping = await page.evaluate(() =>
    window.messageRenders.some((count) => count !== 1),
  )
  if (renderedWhileTyping) throw new Error('Typing rerendered message cells')
  await page.evaluate(() => window.stream())
  await page.waitForFunction(() => window.text === 'x')
  const streamed = await page.evaluate(() => {
    const messages = window.runtime.thread.getState().messages
    return (
      messages.slice(0, 499).every((message, index) => message === window.initialMessages[index]) &&
      messages[499] !== window.initialMessages[499]
    )
  })
  if (!streamed) throw new Error('Streaming invalidated unrelated historical messages')
  const rerenders = await page.evaluate(() => window.messageRenders)
  if (rerenders.slice(0, 499).some((count) => count !== 1) || rerenders[499] !== 2)
    throw new Error('Streaming rerendered unrelated message cells')
  console.log(
    '500-message runtime: 20 draft edits rerendered no message cells; streaming rerendered only the latest reply.',
  )
} finally {
  await browser.close()
}
