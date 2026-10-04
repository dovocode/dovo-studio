import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const environment = `
import {createContext,useContext} from 'react';
export * from '@dovo/protocol';
export const Context=createContext(null);export const useWorkspace=()=>useContext(Context);
export const useRuntime=useWorkspace;export const useConversationSelector=select=>{const value=useWorkspace();return select({task:value.workspace.tasks[0],actions:{threadScope:JSON.stringify([value.connection.address,value.connection.token,value.workspace.tasks[0].id])}})};
export const useStudioHost=()=>({openExternalLink:async url=>{window.external.push(url)},openPullLink:url=>{window.opened.push(url);return true}});
`
const fixture = `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {Effect} from 'effect';import {addTaskPullLinks} from '@dovo/protocol';import {Context} from '@dovo/studio-core';
window.writes=[];window.opened=[];window.external=[];window.alerts=[];window.fail=false;
const url='https://github.com/foreign/project/pull/42/files#note';
const initial={id:'thread',title:'Thread',repositoryId:'original-project',status:'draft',messages:[{id:'m',role:'assistant',text:url}],files:[],draft:'',example:false};
function App(){const[task,setTask]=useState(initial),[connected,setConnected]=useState(true),[runtime,setRuntime]=useState('http://runtime.local');window.setTask=setTask;window.connect=setConnected;window.runtime=setRuntime;
const request=async(path,input)=>{window.writes.push({path,input,runtime});if(window.fail)throw new Error('Link failed');setTask(current=>addTaskPullLinks(current,input.pulls));return {ok:true}};
const value={workspace:{tasks:[task]},connected,connection:{address:runtime,token:'paired'},profile:{connection:{address:runtime,token:'paired'}},request,callEffect:(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error})};
return <Context.Provider value={value}>CONTENT</Context.Provider>};createRoot(document.getElementById('app')).render(<App/>);
`
async function bundle(mobile) {
  const mocks = {
    '@dovo/studio-core': environment,
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;`,
    './task-activity': `export const useTaskActivity=()=>({tools:[],error:''});export const TaskActivity=()=>null;`,
    './turn-label': `export const TurnLabel=()=>null;`,
    './deferred-turn': `export const DeferredTurn=({children})=>children();`,
    './chat-message': `export const ChatMessage=({message})=><a href={message.text}><span>Thread PR</span></a>;`,
    '../../../runtime/connection/provider': `export {useRuntime} from '@dovo/studio-core';`,
    '../state/provider': `export {useConversationSelector} from '@dovo/studio-core';`,
    '../../../ui/content/open-link': `export const openAppLink=async url=>{window.opened.push(url)};`,
    './open-link': `export const openAppLink=async url=>{window.opened.push(url)};`,
    '../../runtime/preferences/app-preferences': `export const useCarMode=()=>false;export const carZoom=1.5;`,
    '../../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../../ui/controls/action': `export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    '../../../ui/layout/sheet': `export const Sheet=({title,children,onClose,busy})=><section role="dialog"><h2>{title}</h2>{children}<button disabled={busy} onClick={onClose}>Close</button></section>;`,
    '../../../ui/content/text': `export {Text} from 'react-native';`,
    './text': `export {Text} from 'react-native';`,
    '../../../ui/theme': `export const styles={};export const colors={};`,
    '../theme': `export const styles={chatText:{}};export const colors={};`,
    './mermaid-diagram': `export const MermaidDiagram=()=>null;`,
    'react-native': `export const View=({children})=><div>{children}</div>;export const Text=({children,onPress,onLongPress})=>onPress?<a href="#" onClick={e=>{e.preventDefault();onPress()}} onContextMenu={e=>{e.preventDefault();onLongPress?.()}}>{children}</a>:<span>{children}</span>;export const Platform={OS:'ios'};export const Alert={alert:(...args)=>window.alerts.push(args)};`,
    'react-native-enriched-markdown': `export const EnrichedMarkdownText=({markdown,onLinkPress,onLinkLongPress})=>{const url=markdown.match(/\\]\\(<([^>]+)>\\)/)?.[1]??markdown;return <a href={url} onClick={e=>{e.preventDefault();onLinkPress({url})}} onContextMenu={e=>{e.preventDefault();onLinkLongPress?.({url})}}>{markdown.includes('&#')?url:'Thread PR'}</a>};`,
  }
  const ui = `${root}/packages/studio-ui/src/components`
  if (!mobile)
    mocks['@dovo/studio-ui'] =
      `export * as ContextMenu from '@radix-ui/react-context-menu';export {Button} from '${ui}/ui/button.tsx';export {IconButton} from '${ui}/icon-button.tsx';export {Dialog,DialogContent,DialogTitle,DialogDescription} from '${ui}/ui/dialog.tsx';export const Conversation=({children,...props})=><div {...props}>{children}</div>;export const ConversationContent=({children})=><div>{children}</div>;export const ConversationHistory=ConversationContent;export const ConversationRail=()=>null;export const ConversationScrollButton=()=>null;`
  const entry = mobile
    ? `import {ThreadMarkdown} from '${root}/apps/mobile/src/tasks/conversation/components/thread-markdown.tsx';${fixture.replace('CONTENT', '<><ThreadMarkdown text={url} variant="chat"/><ThreadMarkdown text={"See "+url+"."} plainText/></>')}`
    : `import {ChatThread} from '${root}/packages/extension-tasks/src/chat/thread/chat-thread.tsx';${fixture.replace('CONTENT', '<ChatThread task={task}/>')}`
  const result = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
    alias: {
      react: `${root}/packages/studio-ui/node_modules/react`,
      'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    },
    nodePaths: [`${root}/packages/studio-ui/node_modules`],
    plugins: [
      {
        name: 'boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents: mocks[path],
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
    const link = page.getByRole('link', { name: 'Thread PR', exact: true })
    await link.click()
    await page.waitForFunction(() => window.opened.length === 1)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.evaluate(() => {
      window.opened = []
    })
    await link.click({ button: 'right' })
    if (!mobile)
      await page.getByRole('menuitem', { name: 'Link to this thread', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.evaluate(() => window.writes.length), 0)
    await page.getByRole('button', { name: 'Link to this thread', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const write = await page.evaluate(() => window.writes[0])
    assert.equal(write.path, '/api/scm/pulls/link-thread')
    assert.equal(write.input.id, 'thread')
    assert.equal(write.input.pulls[0].url, 'https://github.com/foreign/project/pull/42')
    assert.equal(await page.evaluate(() => window.writes.length), 1)
    await link.click({ button: 'right' })
    if (mobile) {
      assert.ok(
        await page.getByRole('button', { name: 'Already linked to this thread' }).isDisabled(),
      )
      await page.getByRole('button', { name: 'Open PR', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    } else {
      assert.ok(
        await page.getByRole('menuitem', { name: 'Already linked to this thread' }).isDisabled(),
      )
      await page.getByRole('menuitem', { name: 'Open PR details', exact: true }).click()
    }
    assert.deepEqual(await page.evaluate(() => window.opened), [
      'https://github.com/foreign/project/pull/42',
    ])
    await page.evaluate(() => {
      window.setTask((task) => ({ ...task, linkedPullRequests: [] }))
      window.connect(false)
    })
    await link.click({ button: 'right' })
    if (!mobile)
      await page.getByRole('menuitem', { name: 'Link to this thread', exact: true }).click()
    assert.ok(
      await page.getByRole('button', { name: 'Link to this thread', exact: true }).isDisabled(),
    )
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => {
      window.connect(true)
      window.setTask((task) => ({ ...task, archivedAt: 'now' }))
    })
    await link.click({ button: 'right' })
    if (!mobile)
      await page.getByRole('menuitem', { name: 'Link to this thread', exact: true }).click()
    assert.ok(
      await page.getByRole('button', { name: 'Link to this thread', exact: true }).isDisabled(),
    )
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => {
      window.setTask((task) => ({ ...task, archivedAt: undefined }))
      window.fail = true
    })
    await link.click({ button: 'right' })
    if (!mobile)
      await page.getByRole('menuitem', { name: 'Link to this thread', exact: true }).click()
    await page.getByRole('button', { name: 'Link to this thread', exact: true }).click()
    await page.getByText('Link failed', { exact: true }).waitFor()
    await page.evaluate(() => {
      window.fail = false
    })
    await page.getByRole('button', { name: 'Link to this thread', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await link.click({ button: 'right' })
    await page.evaluate(() => window.runtime('http://other-runtime.local'))
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    if (mobile) {
      await page.getByRole('link', { name: /https:\/\/github.com/ }).click({ button: 'right' })
      await page.getByRole('dialog').waitFor()
      assert.ok(
        await page.getByRole('button', { name: 'Already linked to this thread' }).isDisabled(),
      )
    }
    if (!mobile) {
      await page.evaluate(() => {
        window.copied = []
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: async (url) => window.copied.push(url) },
          configurable: true,
        })
        window.setTask((task) => ({
          ...task,
          messages: [
            {
              id: 'ordinary',
              role: 'assistant',
              text: 'http://runtime.local/docs?tab=one#section',
            },
          ],
        }))
      })
      await page.locator('#app').dispatchEvent('contextmenu')
      assert.equal(await page.getByRole('menu').count(), 0)
      const ordinary = page.getByRole('link', { name: 'Thread PR', exact: true })
      await ordinary.click({ button: 'right' })
      assert.equal(await page.getByRole('menuitem', { name: 'Open PR details' }).count(), 0)
      await page.getByRole('menuitem', { name: 'Copy link', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.copied), [
        'http://runtime.local/docs?tab=one#section',
      ])
      await ordinary.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Open in default browser', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.external), [
        'http://runtime.local/docs?tab=one#section',
      ])
      await page.evaluate(() => {
        navigator.clipboard.writeText = async () => {
          throw new Error('Clipboard denied')
        }
      })
      await ordinary.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Copy link', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Clipboard denied' }).waitFor()
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Thread PR links: desktop normal click/right-click, mobile normal tap/long-press and plain user links, normalized cross-project links, duplicate/offline/archive guards, failure recovery, native opening and runtime switching passed.',
  )
} finally {
  await browser.close()
}
