import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const environment = `export const useWorkspace=()=>window.connection;export const useRuntime=()=>({...window.connection,profile:{connection:window.connection.connection},read:window.connection.request});`
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
function App(){const [live,setLive]=useState({id:'thread',messages:[message('m2'),message('m3')],turns:[],historyBefore:'m2'});window.setLive=setLive;window.historyState=useConversationHistory(live);return <div>{window.historyState.task.messages.map(m=>m.id).join(',')}</div>}
createRoot(document.getElementById('app')).render(<App/>);`,
        loader: 'tsx',
        resolveDir: root,
      },
      plugins: [
        {
          name: 'history-environment',
          setup(builder) {
            builder.onResolve(
              { filter: /^(@dovo\/studio-core|.*runtime\/connection\/provider)$/ },
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
      await page.waitForFunction(() => window.historyState.busy && window.requests === 1)
    } else if ((await page.evaluate(() => window.requests)) !== 0) {
      throw new Error(`${file}: desktop history unexpectedly prefetched`)
    }
    await page.evaluate(() => {
      window.historyState.load()
    })
    await page.evaluate(() =>
      window.setLive((old) => ({
        ...old,
        messages: [{ id: 'm4', role: 'assistant', text: 'm4' }],
        historyBefore: 'm4',
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
        before: 'm0',
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
    await page.evaluate(() => {
      window.historyState.load()
    })
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
    if (file.startsWith('apps/mobile/')) {
      const requests = await page.evaluate(() => window.requests)
      await page.evaluate(() => {
        window.connection = { ...window.connection, connected: false }
        window.setLive({
          id: 'offline',
          messages: [{ id: 'latest', role: 'assistant', text: 'Latest' }],
          turns: [],
          historyBefore: 'latest',
        })
      })
      await page.waitForFunction(() => window.historyState.task.id === 'offline')
      if ((await page.evaluate(() => window.requests)) !== requests)
        throw new Error('Mobile attempted to prefetch while disconnected')
      await page.evaluate(() => {
        window.connection = { ...window.connection, connected: true }
        window.setLive((old) => ({ ...old }))
      })
      await page.waitForFunction(() => window.historyState.busy)
      await page.evaluate(() =>
        window.reply.resolve({
          messages: [{ id: 'recent', role: 'user', text: 'Recent' }],
          turns: [],
          before: 'recent',
        }),
      )
      await page.waitForFunction(() => !window.historyState.busy)
      if (
        (await page.evaluate(() =>
          window.historyState.task.messages.map((m) => m.id).join(','),
        )) !== 'recent,latest' ||
        (await page.evaluate(() => window.requests)) !== requests + 1
      )
        throw new Error('Mobile did not prefetch exactly one recent page after reconnecting')
    }
    if (errors.length) throw new Error(errors.join('\n'))
    await page.close()
  }
  console.log(
    'Desktop and mobile history preserve rolling live windows, cached bookmarks and host isolation.',
  )
} finally {
  await browser.close()
}
