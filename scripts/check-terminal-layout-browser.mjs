import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const built = await bundleBrowser(
  {
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import {TerminalPane} from './packages/extension-tasks/src/terminal/terminal-pane';
import {Group,Panel} from 'react-resizable-panels';
createRoot(document.getElementById('app')).render(<Group orientation="vertical" style={{height:'100vh'}}><Panel defaultSize="60%"><div>Conversation</div></Panel><Panel id="terminal" defaultSize="40%"><TerminalPane taskId="task" focusId="session" onClose={()=>{}}/></Panel></Group>);`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'iife',
    platform: 'browser',
    nodePaths: [
      root + '/packages/extension-tasks/node_modules',
      root + '/packages/studio-ui/node_modules',
      root + '/node_modules',
    ],
  },
  [
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-core',
      contents: `
export const canChangeTaskCheckout=()=>false;
export const responses={terminal:{},ticket:{}};
export const useWorkspace=()=>window.runtime;
export const useAppPreferences=()=>({terminalFontFamily:'monospace',terminalFontSize:12});
export const useStudioTheme=()=>({card:'#101113',foreground:'#eeeeee',primary:'#eeeeee',background:'#101113'});
export const useResolvedTheme=()=> 'dark';
export const systemMonoFont='monospace'; export const fontStack=()=> 'monospace';
export const terminalInputFrames=data=>[{type:'input',data}];
export const startSocketHeartbeat=()=>({stop(){},receive(){}});
export const startReconnecting=(connect,onError)=>{const controller=new AbortController();connect(controller.signal,()=>{}).catch(onError);return {stop:()=>controller.abort(),restart(){}}};`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `
export const cn=(...parts)=>parts.filter(Boolean).join(' ');
export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;
export const IconButton=({label,children,...props})=><button aria-label={label} {...props}>{children}</button>;
export const ChoicePicker=({children,onValueChange,...props})=><select {...props} onChange={event=>onValueChange(event.target.value)}>{children}</select>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 160 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://terminal.local/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://terminal.local/')
  const assets = root + '/apps/web/dist/client/assets'
  for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + file, 'utf8') })
  await page.evaluate(() => {
    window.sockets = []
    window.runtime = {
      connected: true,
      connection: { address: 'http://runtime.local', token: 'test' },
      workspace: { tasks: [{ id: 'task', execution: 'local' }], repositories: [] },
      snapshot: { terminals: [{ id: 'session', taskId: 'task', title: 'Shell' }] },
      request: async () => ({ ticket: 'fixture' }),
    }
    window.WebSocket = class {
      static OPEN = 1
      readyState = 1
      sent = []
      constructor() {
        window.sockets.push(this)
        setTimeout(() => {
          this.onopen?.()
          this.onmessage?.({
            data: Array.from({ length: 1000 }, (_, i) => 'output ' + i + '\r\n').join(''),
          })
        }, 0)
      }
      send(value) {
        this.sent.push(JSON.parse(value))
      }
      close() {
        this.readyState = 3
      }
    }
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const terminal = page.getByRole('region', { name: 'Terminal', exact: true })
  await terminal.locator('.xterm-screen').waitFor()
  await page.waitForFunction(() =>
    window.sockets[0]?.sent.some((message) => message.type === 'resize'),
  )
  const header = terminal.locator('header')
  const before = await header.boundingBox()
  const screen = await terminal.locator('.xterm-screen').boundingBox()
  await page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2)
  await page.mouse.wheel(0, -10000)
  await page.waitForTimeout(200)
  await page.mouse.wheel(0, 20000)
  await page.waitForTimeout(300)
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.wheel(0, 20000)
  await page.waitForTimeout(300)
  assert.deepEqual(
    await header.boundingBox(),
    before,
    'Terminal tab bar stays fixed at the bottom of scrollback',
  )
  const scrolls = await terminal.evaluate((element) => {
    const result = []
    for (let parent = element; parent; parent = parent.parentElement)
      if (parent.scrollTop) result.push({ tag: parent.tagName, scrollTop: parent.scrollTop })
    return result
  })
  assert.deepEqual(scrolls, [], 'Terminal output does not scroll its containing panel or page')
  await terminal.locator('textarea').focus()
  await page.keyboard.type('pwd')
  assert.ok(
    await page.evaluate(() => window.sockets[0].sent.some((message) => message.type === 'input')),
  )
  await page.setViewportSize({ width: 600, height: 420 })
  await page.waitForTimeout(300)
  assert.ok((await header.boundingBox()).y >= 0, 'Tab bar remains visible after resizing')
  assert.deepEqual(errors, [])
  console.log(
    'Terminal: scrollback, fixed tab bar, parent scroll containment, typing and resizing passed.',
  )
} finally {
  await browser.close()
}
