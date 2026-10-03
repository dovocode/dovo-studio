import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const environment = `export const AppState={addEventListener:(_event,handler)=>{window.background=handler;return {remove:()=>{}}}};export const useWorkspace=()=>window.connection;export const useRuntime=()=>({...window.connection,profile:{connection:window.connection.connection},read:window.connection.request,readCache:window.cache});`
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
function App(){const [live,setLive]=useState(window.initial??{id:'thread',messages:[message('m2'),message('m3')],turns:[],historyBefore:'m2'});window.setLive=setLive;window.historyState=useConversationHistory(live);return <div>{window.historyState.task.messages.map(m=>m.id).join(',')}</div>}
const root=createRoot(document.getElementById('app'));let restart=0;window.restart=()=>root.render(<App key={++restart}/>);root.render(<App/>);`,
        loader: 'tsx',
        resolveDir: root,
      },
      plugins: [
        {
          name: 'history-environment',
          setup(builder) {
            builder.onResolve(
              { filter: /^(@dovo\/studio-core|.*runtime\/connection\/provider|react-native)$/ },
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
      await page.waitForFunction(() => window.historyState.busy)
      await page.evaluate(() => {
        window.connection.request = async (_path, { before }) => {
          window.requests++
          const end = Number(before.slice(1))
          const start = Math.max(0, end - 50)
          return {
            messages: Array.from({ length: end - start }, (_, index) => ({
              id: `m${start + index}`,
              role: 'assistant',
              text: `Message ${start + index}`,
            })),
            turns: [],
            ...(start ? { before: `m${start}` } : {}),
          }
        }
        const saved = new Map()
        window.cache = {
          read: async (key) => (saved.has(key) ? { value: saved.get(key) } : null),
          write: async (key, value) => saved.set(key, value),
        }
        window.saved = saved
        window.setLive({
          id: 'large',
          messages: [398, 399].map((id) => ({
            id: `m${id}`,
            role: 'assistant',
            text: `Message ${id}`,
          })),
          turns: [],
          historyBefore: 'm398',
        })
      })
      await page.waitForFunction(
        () => window.historyState.task.messages.length >= 200 && !window.historyState.busy,
      )
      const count = await page.evaluate(() => window.requests)
      if (count !== 5) throw new Error('Mobile did not automatically fetch four bounded pages')
      await page.evaluate(() =>
        window.setLive((old) => ({
          ...old,
          messages: [...old.messages, { id: 'm400', role: 'assistant', text: 'Streaming' }],
        })),
      )
      await page.waitForFunction(() => window.historyState.task.messages.at(-1)?.id === 'm400')
      if ((await page.evaluate(() => window.requests)) !== count)
        throw new Error('Streaming fetched redundant history')
      await page.evaluate(() => {
        window.connection = { ...window.connection, connected: false }
        window.setLive({ id: 'other', messages: [], turns: [] })
      })
      await page.waitForFunction(
        () => window.saved.get('conversation:large')?.messages.length === 200,
      )
      await page.evaluate(() => {
        window.initial = { id: 'large', messages: [], turns: [] }
        window.restart()
      })
      await page.waitForFunction(() => window.historyState.task.messages.length === 200)
      if ((await page.evaluate(() => window.historyState.task.messages.at(-1)?.id)) !== 'm400')
        throw new Error('Offline reopen lost the latest reply')
      if ((await page.evaluate(() => window.requests)) !== count)
        throw new Error('Offline cache restore fetched network history')
      await page.evaluate(() =>
        window.reply.resolve({
          messages: [{ id: 'stale', role: 'assistant', text: 'Wrong thread' }],
          turns: [],
        }),
      )
      await page.waitForTimeout(20)
      if (
        await page.evaluate(() => window.historyState.task.messages.some((m) => m.id === 'stale'))
      )
        throw new Error('Late response leaked between threads')
      await page.evaluate(() => {
        window.connection = { ...window.connection, connected: true }
        window.setLive({
          id: 'large',
          messages: [700, 701].map((id) => ({
            id: `m${id}`,
            role: 'assistant',
            text: `Message ${id}`,
          })),
          turns: [],
          historyBefore: 'm700',
        })
      })
      await page.waitForFunction(
        () => !window.historyState.busy && window.historyState.task.messages[0]?.id === 'm500',
      )
      if ((await page.evaluate(() => window.requests)) !== count + 4)
        throw new Error('Reconnect failed to refill a gap in cached history')
      await page.evaluate(() => window.background('background'))
      await page.waitForFunction(
        () => window.saved.get('conversation:large')?.messages.at(-1)?.id === 'm701',
      )
      await page.evaluate(() => {
        window.initial = {
          id: 'large',
          messages: [690, 691].map((id) => ({
            id: `m${id}`,
            role: 'assistant',
            text: `Message ${id}`,
          })),
          turns: [],
          historyBefore: 'm690',
        }
        window.restart()
      })
      await page.waitForFunction(
        () =>
          !window.historyState.busy &&
          window.historyState.task.messages.length >= 200 &&
          window.historyState.task.messages.at(-1)?.id === 'm691',
      )
      if (
        await page.evaluate(() =>
          window.historyState.task.messages.some((message) => Number(message.id.slice(1)) > 691),
        )
      )
        throw new Error('Cache resurrected messages removed by a rewind')
      await page.evaluate(() => {
        window.connection.request = async (_path, { before }) => {
          window.requests++
          return { messages: [], turns: [], before }
        }
        window.setLive({
          id: 'broken',
          messages: [{ id: 'broken-last', role: 'assistant', text: 'Last' }],
          turns: [],
          historyBefore: 'broken-last',
        })
      })
      await page.waitForFunction(
        () => !window.historyState.busy && window.historyState.error.includes('did not advance'),
      )
      if ((await page.evaluate(() => window.requests)) !== count + 6)
        throw new Error('Invalid history cursor triggered an automatic retry loop')
      if (errors.length) throw new Error(errors.join('\n'))
      await page.close()
      continue
    }
    if ((await page.evaluate(() => window.requests)) !== 0) {
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
    if (errors.length) throw new Error(errors.join('\n'))
    await page.close()
  }
  console.log(
    'History checks passed: 200-message loading, offline restoration, background saves, reconnect gaps, rewinds, cursor errors and host isolation.',
  )
} finally {
  await browser.close()
}
