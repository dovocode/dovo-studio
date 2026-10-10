import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const built = await build({
  stdin: {
    contents: `import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {studioThemeIds,studioThemes,useDiffOptions} from '@dovo/studio-core';
import {useAppearance} from '${root}/packages/studio-shell/src/appearance.ts';
import Appearance from '${root}/packages/studio-shell/src/app-settings/appearance.tsx';
import {TitleBar} from '${root}/packages/studio-shell/src/title-bar.tsx';
import {Button,Message,MessageContent,MessageResponse,TooltipProvider} from '@dovo/studio-ui';
import {preloadStudioHighlighter} from '@dovo/studio-ui/code-themes';
import {FileDiff} from '@pierre/diffs/react';
import {parseDiffFromFile} from '@pierre/diffs';
import {TerminalSession} from '${root}/packages/extension-tasks/src/terminal/terminal-session.tsx';
const sample='export function greet(name: string) { return "Hello " + name }';
const diff=parseDiffFromFile({name:'hello.ts',contents:'const count = 1;'}, {name:'hello.ts',contents:sample});
window.paletteIds=studioThemeIds;window.palettes=studioThemes;
window.terminals=[];window.sockets=[];
class Socket {
 static OPEN=1;readyState=1;
 constructor(){window.sockets.push(this);setTimeout(()=>{this.onopen?.();setTimeout(()=>this.onmessage?.({data:'theme session preserved\\r\\n'}),0)},0)}
 send(data){const value=JSON.parse(data);if(value.type==='ping')setTimeout(()=>this.onmessage?.({data:new TextEncoder().encode(JSON.stringify({type:'pong',nonce:value.nonce})).buffer}),0)}
 close(){this.readyState=3}
}
window.WebSocket=Socket;
function Diff(){const prefs=useDiffOptions();const [ready,setReady]=useState(false);
useEffect(()=>{preloadStudioHighlighter('typescript').then(()=>setReady(true))},[]);
return ready?<FileDiff fileDiff={diff} options={{...prefs.options,disableFileHeader:true}}/>:null}
function App(){useAppearance();return <TooltipProvider><div className="flex h-screen flex-col bg-background text-foreground">
<TitleBar online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/>
<main className="flex min-h-0 flex-1"><Appearance/>
<aside style={{width:400}} className="flex shrink-0 flex-col gap-4 overflow-auto border-l p-4">
<Button>Start task</Button><Message from="user"><MessageContent>Build this interface.</MessageContent></Message>
<MessageResponse>{'Read the [docs](https://dovocode.com).\\n\\n~~~typescript\\n'+sample+'\\n~~~'}</MessageResponse>
<div data-testid="diff" className="studio-code"><Diff/></div>
<div className="flex h-40 shrink-0 flex-col"><TerminalSession id="fixture" active/></div>
</aside></main></div></TooltipProvider>}
createRoot(document.getElementById('app')).render(<App/>);`,
    loader: 'tsx',
    resolveDir: root,
  },
  bundle: true,
  loader: { '.png': 'dataurl' },
  write: false,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
  },
  nodePaths: [
    root + '/packages/studio-ui/node_modules',
    root + '/packages/extension-tasks/node_modules',
    root + '/node_modules',
  ],
  plugins: [
    {
      name: 'fixture',
      setup(b) {
        b.onResolve({ filter: /^@dovo\/studio-core$/ }, () => ({
          path: 'core',
          namespace: 'fixture',
        }))
        b.onResolve({ filter: /^@xterm\/xterm$/ }, () => ({
          path: 'terminal',
          namespace: 'fixture',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'core'
              ? `export * from '${root}/packages/studio-core/src/index.ts';
export const useStudioHost=()=>({});
const connection={address:'http://fixture.local'};
const request=async()=>({ticket:'fixture'});
export const useWorkspace=()=>({connection,request});`
              : `import {Terminal as Base} from '${root}/packages/extension-tasks/node_modules/@xterm/xterm/lib/xterm.mjs';
export class Terminal extends Base {constructor(options){super(options);window.terminals.push(this)}}`,
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const assets = root + '/apps/web/dist/client/assets'
const css = (
  await Promise.all(
    (await readdir(assets))
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFile(assets + '/' + name, 'utf8')),
  )
).join('\n')
const terminalCSS = await readFile(
  root + '/packages/extension-tasks/node_modules/@xterm/xterm/css/xterm.css',
  'utf8',
)
const logo = await readFile(root + '/packages/studio-shell/src/assets/dovo-logo.png')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://appearance.local/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/app.mjs')
      return route.fulfill({ contentType: 'text/javascript', body: built.outputFiles[0].text })
    if (path.startsWith('/assets/') && path.endsWith('.woff2'))
      return route.fulfill({
        contentType: 'font/woff2',
        body: await readFile(assets + '/' + path.split('/').at(-1)),
      })
    if (path === '/assets/dovo-logo.png')
      return route.fulfill({ contentType: 'image/png', body: logo })
    return route.fulfill({
      contentType: 'text/html',
      body: `<style>${css}\n${terminalCSS}\n@media(max-width:767px){aside{display:none}}</style><div id="app"></div><script type="module" src="/app.mjs"></script>`,
    })
  })
  const ready = () => page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor()
  const choose = async (name) =>
    page.getByRole('radio', { name, exact: true }).locator('..').click()
  const mode = async (name) => {
    await page.getByRole('combobox', { name: 'Color scheme', exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  await page.goto('http://appearance.local/')
  await ready()
  await page.waitForFunction(() =>
    window.terminals?.[0]?.buffer.active
      .getLine(0)
      ?.translateToString()
      .includes('theme session preserved'),
  )
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid=diff] diffs-container')
      ?.shadowRoot?.textContent.includes('greet'),
  )
  assert.equal(await page.getByRole('radio', { name: 'Dovo', exact: true }).isChecked(), true)
  assert.equal(
    await page
      .locator('.studio-titlebar-brand img')
      .evaluate((img) => img.complete && img.naturalWidth === 96),
    true,
  )
  const ids = await page.evaluate(() => window.paletteIds)
  for (const id of ids) {
    const palette = await page.evaluate((id) => window.palettes[id], id)
    await choose(palette.name)
    for (const scheme of ['dark', 'light']) {
      await mode(scheme === 'dark' ? 'Dark' : 'Light')
      await page.waitForFunction(
        ({ id, scheme }) =>
          document.documentElement.dataset.themePalette === id &&
          document.documentElement.dataset.theme === scheme,
        { id, scheme },
      )
      const expected = palette[scheme]
      const actual = await page.evaluate(() => {
        const color = (value) => {
          const div = document.createElement('div')
          div.style.color = value
          document.body.append(div)
          const c = getComputedStyle(div).color
          div.remove()
          return c
        }
        const root = getComputedStyle(document.documentElement)
        const user = document.querySelector('.is-user > div')
        const terminal = window.terminals[0]
        return {
          background: root.getPropertyValue('--background').trim(),
          user: color(getComputedStyle(user).backgroundColor),
          userText: color(getComputedStyle(user).color),
          terminal: terminal.options.theme,
          buffer: terminal.buffer.active.getLine(0).translateToString(),
          sessions: window.sockets.length,
          dark: document.documentElement.classList.contains('dark'),
        }
      })
      const rgb = (hex) =>
        `rgb(${[1, 3, 5].map((pos) => parseInt(hex.slice(pos, pos + 2), 16)).join(', ')})`
      assert.equal(actual.background, expected.background, id + ' ' + scheme)
      // Button transitions settle before comparing the final filled color.
      await page.waitForFunction(
        ({ background, foreground }) => {
          const button = getComputedStyle(document.querySelector('aside button'))
          return button.backgroundColor === background && button.color === foreground
        },
        { background: rgb(expected.action), foreground: rgb(expected['action-foreground']) },
      )
      assert.equal(
        await page
          .getByRole('button', { name: 'Start task', exact: true })
          .evaluate((button) => getComputedStyle(button).color),
        rgb(expected['action-foreground']),
      )
      assert.equal(actual.user, rgb(expected.secondary))
      assert.equal(actual.userText, rgb(expected.foreground))
      assert.equal(actual.terminal.background, expected.card)
      assert.equal(actual.terminal.foreground, expected.foreground)
      assert.equal(actual.sessions, 1, 'Changing themes must not reconnect the terminal')
      assert.ok(actual.buffer.includes('theme session preserved'))
      assert.equal(actual.dark, scheme === 'dark')
      await page.waitForFunction((expected) => {
        const token = [...document.querySelectorAll('[data-streamdown=code-block] span')].find(
          (span) => span.childElementCount === 0 && span.textContent === 'export',
        )
        return token && getComputedStyle(token).color === expected
      }, rgb(expected['syntax-keyword']))
      await page.waitForFunction((expected) => {
        const shadow = document.querySelector('[data-testid=diff] diffs-container')?.shadowRoot
        const token = [...(shadow?.querySelectorAll('span') ?? [])].find(
          (span) => span.childElementCount === 0 && span.textContent === 'export',
        )
        return token && getComputedStyle(token).color === expected
      }, rgb(expected['syntax-keyword']))
    }
  }
  await choose('Claude')
  await mode('System')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.reload()
  await ready()
  assert.equal(await page.getByRole('radio', { name: 'Claude', exact: true }).isChecked(), true)
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.getByRole('combobox', { name: 'App font', exact: true }).fill('Georgia')
  await page
    .getByRole('combobox', { name: 'Code font', exact: true })
    .fill('JetBrains Mono Nerd Font')
  await page
    .getByRole('combobox', { name: 'Terminal font', exact: true })
    .fill('JetBrains Mono Nerd Font')
  await page.getByRole('button', { name: 'Terminal font size', exact: true }).click()
  await page.getByRole('option', { name: '18 px', exact: true }).click()
  await page.waitForFunction(
    () =>
      window.terminals[0].options.fontSize === 18 &&
      window.terminals[0].options.fontFamily.includes('JetBrains Mono Nerd Font'),
  )
  const fontState = await page.evaluate(async () => {
    await document.fonts.ready
    const canvas = document.createElement('canvas').getContext('2d')
    canvas.font = '18px "JetBrains Mono Nerd Font"'
    return {
      app: getComputedStyle(document.documentElement).fontFamily,
      code: getComputedStyle(document.querySelector('[data-streamdown=code-block] code'))
        .fontFamily,
      diffText: getComputedStyle(
        document
          .querySelector('[data-testid=diff] diffs-container')
          .shadowRoot.querySelector('pre'),
      ).fontFamily,
      diff: getComputedStyle(
        document.querySelector('[data-testid=diff] diffs-container'),
      ).getPropertyValue('--diffs-font-family'),
      faces: [...document.fonts]
        .filter((font) => font.family.includes('JetBrains Mono Nerd Font'))
        .map((font) => font.status),
      widths: ['M', '\ue0a0', '\uf07b', '\uf121', '\u{f0001}'].map(
        (glyph) => canvas.measureText(glyph).width,
      ),
      buffer: window.terminals[0].buffer.active.getLine(0).translateToString(),
      sockets: window.sockets.length,
    }
  })
  assert.ok(fontState.app.startsWith('Georgia'))
  assert.ok(fontState.code.includes('JetBrains Mono Nerd Font'))
  assert.ok(fontState.diff.includes('JetBrains Mono Nerd Font'))
  assert.ok(fontState.diffText.includes('JetBrains Mono Nerd Font'))
  assert.deepEqual(fontState.faces, ['loaded', 'loaded'])
  for (const width of fontState.widths)
    assert.ok(Math.abs(width - fontState.widths[0]) < 0.1, 'Nerd icons fit one monospace cell')
  assert.equal(fontState.sockets, 1, 'Changing fonts must not reconnect the terminal')
  assert.ok(fontState.buffer.includes('theme session preserved'))
  await page.reload()
  await ready()
  assert.equal(
    await page.getByRole('combobox', { name: 'App font', exact: true }).inputValue(),
    'Georgia',
  )
  assert.equal(
    await page.getByRole('combobox', { name: 'Code font', exact: true }).inputValue(),
    'JetBrains Mono Nerd Font',
  )
  assert.equal(
    await page.getByRole('combobox', { name: 'Terminal font', exact: true }).inputValue(),
    'JetBrains Mono Nerd Font',
  )
  await page.waitForFunction(() => window.terminals[0].options.fontSize === 18)
  // A generic family works as CSS, and clearing a field restores the device default.
  await page.getByRole('combobox', { name: 'App font', exact: true }).fill('serif')
  assert.ok(
    (
      await page.locator('html').evaluate((element) => getComputedStyle(element).fontFamily)
    ).startsWith('serif'),
  )
  await page.getByRole('combobox', { name: 'App font', exact: true }).fill('')
  await page.getByRole('combobox', { name: 'Terminal font', exact: true }).fill('')
  await page.waitForFunction(() =>
    window.terminals[0].options.fontFamily.startsWith('ui-monospace'),
  )
  // Native radio cards support keyboard navigation as well as pointer selection.
  await page.getByRole('radio', { name: 'Claude', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('radio', { name: 'T3 Code', exact: true }).isChecked(), true)
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    if (process.env.DOVO_APPEARANCE_SCREENSHOT)
      await page.screenshot({
        path: process.env.DOVO_APPEARANCE_SCREENSHOT.replace('.png', `-${width}.png`),
      })
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Appearance fits ${width}px screens`,
    )
    assert.ok(
      await page
        .getByRole('combobox', { name: 'Color scheme', exact: true })
        .evaluate((control) => {
          const buttons = control.getBoundingClientRect()
          const label = control.parentElement.previousElementSibling.getBoundingClientRect()
          return buttons.left >= label.right || buttons.top >= label.bottom
        }),
      'Color scheme buttons must not overlap their description',
    )
  }
  await page.setViewportSize({ width: 390, height: 844 })
  if (process.env.DOVO_APPEARANCE_SCREENSHOT)
    await page.screenshot({ path: process.env.DOVO_APPEARANCE_SCREENSHOT })
  assert.deepEqual(errors, [])
  console.log(
    'Appearance: all 28 palette/mode combinations, markdown/diff syntax, font persistence, bundled Nerd glyphs, terminal continuity, system mode, persistence, keyboard selection, logo and narrow layout passed.',
  )
} finally {
  await browser.close()
}
