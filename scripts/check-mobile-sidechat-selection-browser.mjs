import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  'react-native': `export const View=({children})=><div>{children}</div>;export const Alert={alert(){}};`,
  '../../../runtime/connection/provider': `import {Effect} from 'effect';export const useRuntime=()=>({connected:true,call:async(path,input)=>{window.calls.push({path,input});return {answer:'ok'}},callEffect:()=>Effect.succeed({id:'created'})});`,
  '../../../ui/controls/use-action': `import {Effect} from 'effect';export const useAction=()=>({act:effect=>Effect.runPromise(effect()),busy:false,error:''});`,
  '../../../ui/controls/action': `export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  '../../../ui/controls/choice': `export const Choice=({label,value,items,onChange})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value=""/>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
  '../../../ui/controls/field': `export const Field=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/>;`,
  './thread-markdown': `export const ThreadMarkdown=({text})=><span>{text}</span>;`,
  '../../../ui/layout/sheet': `export const Sheet=({children,footer})=><div>{children}{footer}</div>;`,
  '../../../ui/content/text': `export const Text=({children})=><span>{children}</span>;`,
  '../../../ui/theme': `export const useTheme=()=>({styles:{}});`,
  '../state/provider': `export const useTaskConversation=()=>({actions:{draft:{text:'',update(){}}}});`,
}
const built = await build({
  stdin: {
    contents: `import {useState} from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';import {SideQuestion} from '${root}apps/mobile/src/tasks/conversation/components/side-question.tsx';window.calls=[];window.chat=id=>({id,title:id,draft:id+' draft',messages:[]});function App(){const [chats,setChats]=useState([window.chat('old')]);const [requested,setRequested]=useState('future');const [drafts,setDrafts]=useState({});window.update=(ids,request)=>flushSync(()=>{setChats(ids.map(window.chat));setRequested(request)});return <SideQuestion task={{id:'task',sideChats:chats}} selectedChatId={requested} drafts={drafts} setDrafts={setDrafts} onClose={()=>{}}/>};createRoot(document.getElementById('app')).render(<App/>);`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  format: 'iife',
  platform: 'browser',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
  },
  nodePaths: [root + 'packages/studio-ui/node_modules'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'native-adapters',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const pending = async () => {
    await page.getByText('Loading side chat…').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Ask', exact: true }).count(), 0)
    assert.equal(
      await page.getByRole('button', { name: 'Rename side chat', exact: true }).count(),
      0,
    )
  }
  await pending()
  await page.evaluate(() => window.update(['old', 'future'], 'future'))
  assert.equal(await page.getByLabel('Question').inputValue(), 'future draft')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await page.waitForFunction(() => window.calls.length === 1)
  assert.equal(await page.evaluate(() => window.calls[0].input.chatId), 'future')
  await page.evaluate(() => window.update(['old', 'future'], 'another'))
  await pending()
  await page.evaluate(() => window.update(['old', 'future', 'another'], 'another'))
  assert.equal(await page.getByLabel('Question').inputValue(), 'another draft')
  await page.evaluate(() => window.update(['old', 'future'], 'another'))
  assert.equal(await page.getByLabel('Question').inputValue(), 'old draft')
  await page.getByRole('button', { name: 'New side chat', exact: true }).click()
  await pending()
  await page.evaluate(() => window.update(['old', 'future', 'created'], 'another'))
  assert.equal(await page.getByLabel('Question').inputValue(), 'created draft')
  await page.getByLabel('Side chat', { exact: true }).selectOption('old')
  assert.equal(await page.getByLabel('Question').inputValue(), 'old draft')
  assert.deepEqual(errors, [])
  console.log(
    'Mobile side chats: requested and newly-created chat snapshot races, prop changes, arrival, deleted-chat fallback and manual selection passed.',
  )
} finally {
  await browser.close()
}
