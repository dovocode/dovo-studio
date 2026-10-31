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
const node=createRoot(document.getElementById('app'));window.render=()=>node.render(window.mounted===false?null:<Group orientation="vertical" style={{height:'100vh'}}><Panel defaultSize="60%"><div>Conversation</div></Panel><Panel id="terminal" defaultSize="40%"><TerminalPane taskId={window.taskId??"task"} focusId={window.focusId??"session"} onOpenFile={file=>window.openedFiles.push(file)} onClose={()=>{}} onAddSelection={(taskId,text)=>window.insertions.push({taskId,text})}/></Panel></Group>);window.render();`,
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
      path: '@xterm/xterm',
      contents: `import {Terminal as Base} from '${root}/packages/extension-tasks/node_modules/@xterm/xterm/lib/xterm.mjs';export class Terminal extends Base {constructor(options){super(options);window.terminals.push(this)} registerLinkProvider(provider){window.linkProviders.push({terminal:this,provider});return super.registerLinkProvider(provider)}}`,
    },
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
export * from '${root}/packages/studio-ui/src/components/ui/dialog';
export * as ContextMenu from '@radix-ui/react-context-menu';
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
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('Browser error:', error.message)
  })
  await page.route('http://terminal.local/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://terminal.local/')
  const assets = root + '/apps/web/dist/client/assets'
  for (const file of (await readdir(assets)).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: await readFile(assets + '/' + file, 'utf8') })
  await page.evaluate(() => {
    window.sockets = []
    window.terminals = []
    window.linkProviders = []
    window.openedFiles = []
    window.insertions = []
    window.copied = []
    window.clipboardReads = 0
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text) => {
          if (window.clipboardError) throw new Error('Clipboard permission denied')
          window.copied.push(text)
        },
        readText: async () => {
          window.clipboardReads++
          if (window.clipboardError) throw new Error('Clipboard permission denied')
          if (window.holdClipboard)
            return new Promise((resolve) => {
              window.finishClipboard = resolve
            })
          return 'pasted command'
        },
      },
    })
    window.created = 0
    window.runtime = {
      connected: true,
      connection: { address: 'http://runtime.local', token: 'test' },
      workspace: { tasks: [{ id: 'task', execution: 'local' }], repositories: [] },
      snapshot: { terminals: [{ id: 'session', taskId: 'task', title: 'Shell' }] },
      request: async (path, input) => {
        if (path === '/api/terminals') {
          const session = {
            id: 'session-' + ++window.created,
            taskId: 'task',
            title: 'Shell ' + window.created,
          }
          window.runtime.snapshot = { terminals: [...window.runtime.snapshot.terminals, session] }
          window.render()
          return session
        }
        if (path === '/api/terminals/close') {
          window.closes ??= []
          window.closes.push({ id: input.id, address: window.runtime.connection.address })
          if (window.holdClose)
            await new Promise((resolve) => {
              window.finishClose = resolve
            })
          if (window.failClose) throw new Error('Close rejected')
          window.runtime.snapshot = {
            terminals: window.runtime.snapshot.terminals.filter(
              (session) => session.id !== input.id,
            ),
          }
          window.render()
          return { ok: true }
        }
        if (path === '/api/terminals/file') return { taskId: 'task', path: input.path }
        return { ticket: 'fixture' }
      },
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
  const selectionScreen = await terminal.locator('.xterm-screen').boundingBox()
  await page.mouse.move(selectionScreen.x + 3, selectionScreen.y + 7)
  await page.mouse.down()
  await page.mouse.move(selectionScreen.x + 45, selectionScreen.y + 7, { steps: 8 })
  await page.mouse.up()
  await terminal.getByRole('button', { name: 'Add selection to message' }).click()
  const [selection] = await page.evaluate(() => window.insertions)
  assert.equal(selection.taskId, 'task')
  assert.match(selection.text, /output/)
  const openMenu = async () => {
    await terminal.locator('.xterm-screen').click({ button: 'right', position: { x: 5, y: 5 } })
    await page.getByRole('menuitem', { name: 'Jump to latest', exact: true }).waitFor()
  }
  await openMenu()
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await page.waitForFunction(() => window.copied.length === 1)
  assert.match(await page.evaluate(() => window.copied[0]), /output/)
  await openMenu()
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click()
  await page.waitForFunction(() =>
    window.sockets[0].sent.some(
      (frame) => frame.type === 'input' && frame.data === 'pasted command',
    ),
  )
  await openMenu()
  await page.getByRole('menuitem', { name: 'Select all', exact: true }).click()
  await openMenu()
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await page.waitForFunction(() => window.copied.length === 2)
  assert.match(await page.evaluate(() => window.copied[1]), /output 0\r?\noutput 1/)
  await openMenu()
  await page.getByRole('menuitem', { name: 'Add selection to message', exact: true }).click()
  await page.waitForFunction(() => window.insertions.length === 2)
  await page.evaluate(() => window.terminals[0].scrollToTop())
  await page.waitForFunction(() => window.terminals[0].buffer.active.viewportY === 0)
  await openMenu()
  await page.getByRole('menuitem', { name: 'Jump to latest', exact: true }).click()
  await page.waitForFunction(() => {
    const buffer = window.terminals[0].buffer.active
    return buffer.viewportY === buffer.baseY && buffer.baseY > 0
  })
  await page.evaluate(() => {
    window.clipboardError = true
  })
  await openMenu()
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click()
  await terminal.getByRole('alert').filter({ hasText: 'Clipboard permission denied' }).waitFor()
  await page.evaluate(() => {
    window.clipboardError = false
    window.holdClipboard = true
  })
  await openMenu()
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click()
  await page.waitForFunction(() => !!window.finishClipboard)
  await page.evaluate(() => {
    window.runtime = {
      ...window.runtime,
      connection: { address: 'http://other-runtime.local', token: 'other' },
    }
    window.render()
  })
  await page.waitForFunction(() => window.sockets.length === 2)
  await page.evaluate(() => {
    window.finishClipboard('must not reach another computer')
  })
  await openMenu()
  // macOS right-click can select the word under the pointer. Exercise the empty-selection
  // state explicitly instead of depending on platform-specific pointer selection behavior.
  await page.evaluate(() => window.terminals.at(-1).clearSelection())
  await page
    .getByRole('menuitem', { name: 'Copy', exact: true })
    .and(page.locator('[data-disabled]'))
    .waitFor()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).getAttribute('data-disabled'),
    '',
    'Copy is unavailable without a selection',
  )
  assert.equal(
    await page.evaluate(() =>
      window.sockets
        .flatMap((socket) => socket.sent)
        .some((frame) => frame.data === 'must not reach another computer'),
    ),
    false,
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.runtime = { ...window.runtime, connected: false }
    window.render()
  })
  await openMenu()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Paste', exact: true }).getAttribute('data-disabled'),
    '',
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.runtime = {
      ...window.runtime,
      connected: true,
      snapshot: { terminals: [{ id: 'session', taskId: 'task', title: 'Shell', exited: true }] },
    }
    window.render()
  })
  await openMenu()
  assert.equal(
    await page.getByRole('menuitem', { name: 'Paste', exact: true }).getAttribute('data-disabled'),
    '',
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    window.runtime = {
      ...window.runtime,
      snapshot: { terminals: [{ id: 'session', taskId: 'task', title: 'Shell' }] },
    }
    window.render()
  })
  const inputsBeforeTyping = await page.evaluate(
    () => window.sockets.at(-1).sent.filter((message) => message.type === 'input').length,
  )
  await terminal.locator('textarea').focus()
  await page.keyboard.type('pwd')
  await page.waitForFunction(
    (count) =>
      window.sockets.at(-1).sent.filter((message) => message.type === 'input').length > count,
    inputsBeforeTyping,
  )
  const beforeControls = await page.evaluate(() => window.runtime.snapshot.terminals.length)
  await page.keyboard.press('Control+d')
  await page.keyboard.press('Control+w')
  await page.keyboard.press('Control+n')
  await page.waitForFunction(() =>
    ['\u0004', '\u0017', '\u000e'].every((data) =>
      window.sockets.at(-1).sent.some((frame) => frame.type === 'input' && frame.data === data),
    ),
  )
  assert.equal(
    await page.evaluate(() => window.runtime.snapshot.terminals.length),
    beforeControls,
    'Shell control keys do not split or close terminals',
  )
  await page.setViewportSize({ width: 600, height: 420 })
  await page.waitForTimeout(300)
  assert.ok((await header.boundingBox()).y >= 0, 'Tab bar remains visible after resizing')
  await page.setViewportSize({ width: 1200, height: 850 })
  const split = terminal.getByRole('button', {
    name: 'Split terminal left/right (Ctrl+Shift+D, max 4 panes)',
    exact: true,
  })
  await split.click()
  await terminal.locator('.xterm-screen:visible').nth(1).waitFor()
  await terminal.locator('[data-terminal-session="session"]').click()
  await terminal.getByRole('button', { name: 'Next pane', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.activeElement.closest('[data-terminal-session]')?.dataset.terminalSession ===
      'session-1',
  )
  await terminal.getByRole('button', { name: 'Stack panes', exact: true }).click()
  await terminal.getByRole('button', { name: 'Side by side', exact: true }).waitFor()
  await terminal.locator('[data-terminal-session="session-1"] textarea').focus()
  await page.keyboard.press('Control+Shift+d')
  await terminal.locator('.xterm-screen:visible').nth(2).waitFor()
  await terminal.locator('[data-terminal-session="session-2"] textarea').focus()
  await page.keyboard.press('Control+Shift+e')
  await terminal.locator('.xterm-screen:visible').nth(3).waitFor()
  assert.equal(await split.isDisabled(), true, 'Split cap prevents fifth pane')
  assert.equal(
    await terminal.getByRole('button', { name: 'New terminal session', exact: true }).isEnabled(),
    true,
  )
  assert.deepEqual(
    await terminal
      .locator('[data-terminal-session]:visible')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.terminalSession)),
    ['session', 'session-1', 'session-2', 'session-3'],
  )
  await page.evaluate(() => {
    window.focusId = ''
    window.mounted = false
    window.render()
  })
  await terminal.waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.mounted = true
    window.render()
  })
  await terminal.locator('.xterm-screen:visible').nth(3).waitFor()
  await terminal.getByRole('button', { name: 'Side by side', exact: true }).waitFor()
  await page.waitForFunction(
    () =>
      document.activeElement.closest('[data-terminal-session]')?.dataset.terminalSession ===
      'session-3',
  )
  await page.keyboard.press('Control+Shift+w')
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.evaluate(() => window.runtime.snapshot.terminals.length), 4)
  assert.equal(
    await page
      .getByRole('button', { name: 'Cancel', exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.activeElement.closest('[data-terminal-session]')?.dataset.terminalSession ===
      'session-3',
  )
  await page.keyboard.press('Control+Shift+w')
  // A focus change after opening must not change the captured close target.
  await page.evaluate(() => {
    window.focusId = 'session-1'
    window.render()
  })
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click()
  await page.waitForFunction(() => window.runtime.snapshot.terminals.length === 3)
  await page.waitForFunction(
    () =>
      document.activeElement.closest('[data-terminal-session]')?.dataset.terminalSession ===
      'session',
  )
  await page.evaluate(() => {
    window.focusId = 'session-2'
    window.render()
  })
  await page.waitForFunction(
    () =>
      document.activeElement.closest('[data-terminal-session]')?.dataset.terminalSession ===
      'session-2',
  )
  await terminal.getByRole('button', { name: 'New terminal session', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.activeElement.closest('[data-terminal-session]')?.dataset.terminalSession ===
      'session-4',
  )
  await terminal.getByRole('button', { name: 'Close terminal tab 2', exact: true }).click()
  await page.getByRole('button', { name: 'Close terminal', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.activeElement.closest('[data-terminal-session]')?.dataset.terminalSession ===
      'session',
  )
  const link = await page.evaluate(async () => {
    const entry = window.linkProviders.findLast((entry) => entry.terminal.element?.isConnected)
    const term = entry.terminal
    term.reset()
    const path = 'src/' + 'long/'.repeat(30) + 'file.ts'
    await new Promise((resolve) => term.write('界 ' + path + ':12:3', resolve))
    const links = await new Promise((resolve) => entry.provider.provideLinks(2, resolve))
    const link = links[0]
    link.activate()
    return { text: link.text, start: link.range.start, end: link.range.end, path }
  })
  assert.equal(link.text, link.path + ':12:3')
  assert.ok(link.end.y > link.start.y, 'Wrapped terminal location spans rows')
  assert.equal(link.start.x, 4, 'Wide characters use terminal cell columns')
  await page.waitForFunction(() => window.openedFiles.length === 1)
  assert.deepEqual(await page.evaluate(() => window.openedFiles[0]), {
    path: link.path,
    line: 12,
    column: 3,
  })
  await terminal.getByRole('button', { name: 'Close terminal tab 1', exact: true }).click()
  await page.getByRole('heading', { name: 'Close 3 terminal panes?' }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await terminal.getByRole('button', { name: 'Close terminal tab 1', exact: true }).click()
  const beforeScope = await page.evaluate(() => window.closes.length)
  await page.evaluate(() => {
    window.runtime = {
      ...window.runtime,
      connection: { ...window.runtime.connection, token: 'third' },
    }
    window.render()
  })
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.closes.length), beforeScope)
  await terminal.getByRole('button', { name: 'Close terminal tab 1', exact: true }).click()
  await page.evaluate(() => {
    window.taskId = 'other-task'
    window.render()
  })
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.closes.length), beforeScope)
  await page.evaluate(() => {
    window.taskId = 'task'
    window.render()
  })
  await terminal.getByRole('button', { name: 'Close terminal tab 1', exact: true }).click()
  await page.evaluate(() => {
    window.failClose = true
  })
  await page.getByRole('button', { name: 'Close terminal panes', exact: true }).click()
  await terminal.getByRole('alert').filter({ hasText: 'Close rejected' }).waitFor()
  await page.waitForFunction(() => !!document.activeElement.closest('[data-terminal-session]'))
  await page.evaluate(() => {
    window.failClose = false
    window.holdClose = true
  })
  await terminal.getByRole('button', { name: 'Close terminal tab 1', exact: true }).click()
  await page.getByRole('button', { name: 'Close terminal panes', exact: true }).click()
  await page.waitForFunction(() => !!window.finishClose)
  await terminal.locator('textarea').first().focus()
  await page.keyboard.press('Control+Shift+w')
  assert.equal(
    await page.getByRole('dialog').count(),
    0,
    'Pending request cannot open another confirmation',
  )
  await page.evaluate(() => {
    const original = window.runtime.request
    window.replacementCalls = 0
    window.replacementReads = 0
    window.runtime = {
      ...window.runtime,
      request: (...args) => {
        if (args[0] === '/api/terminals/close') window.replacementCalls++
        else window.replacementReads++
        return original(...args)
      },
    }
    window.render()
  })
  await page.waitForFunction(() => window.replacementReads > 0)
  await page.evaluate(() => {
    window.holdClose = false
    window.finishClose()
  })
  await page.waitForFunction(() => window.runtime.snapshot.terminals.length === 2)
  assert.equal(
    await page.evaluate(() => window.replacementCalls),
    0,
    'Scope change stops remaining group requests',
  )
  await terminal.getByRole('button', { name: 'Close terminal tab 1', exact: true }).click()
  await page.getByRole('heading', { name: 'Close 2 terminal panes?' }).waitFor()
  await page.getByRole('button', { name: 'Close terminal panes', exact: true }).click()
  await page.waitForFunction(() => window.runtime.snapshot.terminals.length === 0)
  assert.equal(await page.evaluate(() => window.replacementCalls), 2)
  assert.deepEqual(errors, [])
  console.log(
    'Terminal: scrollback, fixed tab bar, parent scroll containment, typing, resizing, copy/paste, select-all, jump, clipboard errors, connection/exited guards stale paste isolation, split focus/orientation/shortcuts/cap, layout restoration and wrapped file locations passed.',
  )
} finally {
  await browser.close()
}
