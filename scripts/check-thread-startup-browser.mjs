import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const built = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { Conversation, ConversationContent, ConversationHistory } from './src/components/ai-elements/conversation.tsx';
import { DeferredTurn } from '../extension-tasks/src/chat/thread/deferred-turn.tsx';
window.rendered = [];
createRoot(document.getElementById('app')).render(<Conversation id="conversation" style={{height:500,width:600}}><ConversationHistory><ConversationContent style={{display:'flex',flexDirection:'column',gap:8}}>{Array.from({length:500},(_,index)=><DeferredTurn key={index} immediate={index>=498}>{()=>{window.rendered.push(index);return <div id={'message-'+index} style={{height:240}}>Message {index}</div>}}</DeferredTurn>)}</ConversationContent></ConversationHistory></Conversation>);
`,
    resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'empty' },
  jsx: 'automatic',
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.waitForFunction(() => window.rendered.includes(499))
  await page.waitForFunction(() => {
    const el = document.querySelector('#conversation > div')
    return el.scrollHeight - el.clientHeight - el.scrollTop < 2
  })
  const first = await page.evaluate(() => window.rendered)
  if (first[0] !== 498 || first[1] !== 499 || first.includes(0) || first.length > 12)
    throw new Error('Old history rendered before latest: ' + JSON.stringify(first))
  // Real upward input suspends automatic following; a programmatic scroll alone
  // can be pulled back to the bottom by the conversation's active follow state.
  await page.locator('#conversation > div').hover()
  await page.mouse.wheel(0, -200000)
  await page.waitForFunction(() => window.rendered.includes(0))
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Latest turns rendered first; old history stayed deferred and loaded on upward scrolling. Initial rendered turns:',
    first.length,
  )
} finally {
  await browser.close()
}
