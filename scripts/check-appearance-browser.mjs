import { installThemeCatalogRoutes, exerciseThemeBrowser } from './browser/theme-catalog.mjs'
import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { createServer } from 'vite-plus'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const vite = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
})
await vite.listen()
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
const built = await build({
  stdin: {
    contents: `import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {studioThemeIds,studioThemes} from '@dovo/studio-core';
import {useAppearance} from '${root}/packages/studio-shell/src/appearance.ts';
import Appearance from '${root}/packages/studio-shell/src/app-settings/appearance.tsx';
import {TitleBar} from '${root}/packages/studio-shell/src/title-bar.tsx';
import {Button,Message,MessageContent,MessageResponse,TooltipProvider,PullRequestIcon,ComposerSubmit} from '@dovo/studio-ui';
import {preloadStudioHighlighter,useDiffOptions} from '@dovo/studio-ui/code-themes';
import {FileDiff} from '@pierre/diffs/react';
import {parseDiffFromFile} from '@pierre/diffs';
import {Segmented} from '${root}/packages/studio-ui/src/settings-layout.tsx';
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
function App(){useAppearance();return <TooltipProvider><div className="studio flex h-screen flex-col bg-background text-foreground">
<TitleBar online={1} devices={1} onDevices={()=>{}} onSearch={()=>{}}/>
<main className="flex min-h-0 flex-1"><Appearance/>
<aside style={{width:400}} className="flex shrink-0 flex-col gap-4 overflow-auto border-l p-4">
<Button>Start thread</Button>
<div data-testid="effects" className="flex flex-col gap-2">
<nav className="studio-navigation" aria-label="Main navigation"><button className="studio-navigation-item" aria-current="page">T</button></nav>
<nav className="studio-navigation studio-tools-navigation" aria-label="Thread tools"><button className="studio-navigation-item" aria-pressed="true">F</button></nav>
<div className="studio-browser-sidebar"><div className="studio-browser-tab" data-active><button className="studio-browser-tab-select">Selected browser tab</button></div><details open className="studio-list-section"><summary className="studio-list-section-header">Browser section</summary></details></div>
<div className="studio-task-sidebar"><details open className="studio-list-section"><summary className="studio-list-section-header">Thread section</summary></details><div className="studio-thread-row" data-highlighted><button className="studio-thread-card">Selected thread</button></div><button className="studio-thread-child" aria-current="true">Selected child thread</button></div>
<button className="studio-selected-surface rounded-lg border" aria-current="true">Selected artifact</button>
<div className="studio-nav-selected rounded-lg border">Selected settings page</div>
<div className="studio-settings-target" data-override="true">Project override target</div>
<Segmented label="Effects settings choice" value="selected" options={[["selected","Selected option"],["other","Other option"]]} onChange={()=>{}}/>
<div className="task-composer"><div className="studio-composer"><textarea aria-label="Effects composer"/><button type="submit">Send</button><ComposerSubmit type="button" variant="destructive" className="studio-destructive-accent" data-composer-stop aria-label="Stop">■</ComposerSubmit></div></div>
<div className="dovo-dialog-content p-3"><Button>Dialog action</Button></div>
</div>
<div data-testid="pull-states"><PullRequestIcon state="open"/><PullRequestIcon state="closed"/><PullRequestIcon state="merged"/></div><Message from="user"><MessageContent>Build this interface.</MessageContent></Message>
<div data-preserved-lines><MessageResponse preserveLineBreaks>{'First line\\nSecond line\\nThird line'}</MessageResponse></div>
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
  define: {
    'import.meta.url': JSON.stringify(`${origin}/packages/terminal/src/browser/terminal.ts`),
  },
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol/browser-viewer': root + '/packages/protocol/src/generated/browser-viewer.ts',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
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
        b.onResolve({ filter: /^@dovo\/terminal$/ }, () => ({
          path: 'terminal',
          namespace: 'fixture',
        }))
        b.onResolve({ filter: /^@dovo\/studio-ui\/terminal-fonts$/ }, () => ({
          path: 'fonts',
          namespace: 'terminal-fonts',
        }))
        b.onLoad({ filter: /.*/, namespace: 'terminal-fonts' }, async () => ({
          contents: (
            await readFile(root + '/packages/studio-ui/src/terminal-fonts.ts', 'utf8')
          ).replaceAll(
            'import.meta.url',
            JSON.stringify(origin + '/packages/studio-ui/src/terminal-fonts.ts'),
          ),
          loader: 'ts',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'core'
              ? `export * from '${root}/packages/studio-core/src/index.ts';
export const useStudioHost=()=>({});
const connection={address:'http://fixture.local'};
const request=async()=>({ticket:'fixture'});
export const useWorkspace=()=>({connection,request});`
              : `import {BrowserTerminal as Base} from '${root}/packages/terminal/src/browser/terminal.ts';
export const openElectronTerminalPort=async()=>undefined;
export {terminalDropPaths} from '${root}/packages/terminal/src/browser/drop';
export class BrowserTerminal extends Base {
constructor(options){super({...options,renderer:'canvas2d'});window.terminals.push(this)}
async connect(url,signal,opened){await this.ready;const channel=new MessageChannel();const socket=new WebSocket(url);channel.port1.onmessage=event=>{if(typeof event.data==='string')socket.send(event.data);else if(event.data.type==='close')socket.close()};channel.port1.start();socket.onopen=()=>channel.port1.postMessage({type:'open'});socket.onmessage=event=>channel.port1.postMessage({type:'data',data:event.data});socket.onclose=()=>channel.port1.postMessage({type:'close',message:'Closed'});try{await super.connect(url,signal,opened,channel.port2)}finally{channel.port1.close();socket.close()}}
}`,
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
const terminalCSS = await readFile(root + '/packages/terminal/src/browser/styles.css', 'utf8')
const logo = await readFile(root + '/packages/studio-shell/src/assets/dovo-logo.png')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(15000)
  const catalog = await installThemeCatalogRoutes(page)
  await page.addInitScript(() => {
    window.catalogRequests = []
    const original = window.fetch
    window.fetch = (...args) => {
      const url = new URL(
        args[0] instanceof Request ? args[0].url : args[0].toString(),
        location.href,
      )
      if (url.origin === 'https://open-vsx.org' && url.pathname === '/api/-/search')
        window.catalogRequests.push(url.searchParams.get('query'))
      return original(...args)
    }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/app.mjs')
      return route.fulfill({ contentType: 'text/javascript', body: built.outputFiles[0].text })
    if (path === '/packages/terminal/src/browser/terminal.worker.ts')
      return route.continue({ url: route.request().url() + '?worker_file&type=module' })
    if (path.startsWith('/assets/') && path.endsWith('.woff2'))
      return route.fulfill({
        contentType: 'font/woff2',
        body: await readFile(assets + '/' + path.split('/').at(-1)),
      })
    if (path === '/assets/dovo-logo.png')
      return route.fulfill({ contentType: 'image/png', body: logo })
    if (path !== '/') return route.continue()
    return route.fulfill({
      contentType: 'text/html',
      body: `<style>${css}\n${terminalCSS}\n@media(max-width:767px){aside{display:none}}</style><div id="app"></div><script type="module" src="/app.mjs"></script>`,
    })
  })
  const ready = () => page.getByRole('heading', { name: 'Appearance', exact: true }).waitFor()
  const palettePicker = page.locator('details[data-setting-label="Color palette choices"]')
  const browsePalettes = palettePicker.locator('summary')
  const openPalettes = async () => {
    if ((await palettePicker.getAttribute('open')) === null) await browsePalettes.click()
  }
  const choose = async (name) => {
    await openPalettes()
    await page.getByRole('radio', { name, exact: true }).locator('..').click()
    await browsePalettes.click()
    assert.equal(
      await page
        .getByRole('img', { name: `Current color palette: ${name}`, exact: true })
        .isVisible(),
      true,
    )
  }
  const mode = async (name) => {
    await page.getByRole('combobox', { name: 'Color scheme', exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  await page.goto(origin)
  await ready()
  const preserved = page.locator('[data-preserved-lines] p')
  await preserved.waitFor()
  const lineTops = await preserved.evaluate((el) => {
    const node = el.firstChild
    return [0, 11, 23].map((offset) => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      return range.getBoundingClientRect().top
    })
  })
  assert.ok(
    lineTops[1] > lineTops[0] && lineTops[2] > lineTops[1],
    'Entered single line breaks remain visible in sent messages',
  )
  await page.waitForFunction(() =>
    window.terminals?.[0]?.viewport?.lines.some((line) =>
      line.text.includes('theme session preserved'),
    ),
  )
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid=diff] diffs-container')
      ?.shadowRoot?.textContent.includes('greet'),
  )
  assert.equal(await palettePicker.getAttribute('open'), null, 'Palette browser starts collapsed')
  assert.equal(
    await page.getByRole('img', { name: 'Current color palette: Dovo', exact: true }).isVisible(),
    true,
  )
  assert.equal(
    await palettePicker.getByRole('radio').count(),
    0,
    'Palette choices stay out of the collapsed page',
  )
  if (process.env.DOVO_APPEARANCE_SCREENSHOT)
    await page.screenshot({
      path: process.env.DOVO_APPEARANCE_SCREENSHOT.replace('.png', '-collapsed.png'),
    })
  await browsePalettes.focus()
  await page.keyboard.press('Enter')
  assert.equal(
    await palettePicker.getByRole('radio').count(),
    await page.evaluate(() => window.paletteIds.length),
  )
  assert.equal(await page.getByRole('radio', { name: 'Dovo', exact: true }).isChecked(), true)
  if (process.env.DOVO_APPEARANCE_SCREENSHOT)
    await page.screenshot({
      path: process.env.DOVO_APPEARANCE_SCREENSHOT.replace('.png', '-palettes.png'),
    })
  await page.keyboard.press('Enter')
  assert.equal(
    await palettePicker.getAttribute('open'),
    null,
    'Palette browser closes from the keyboard',
  )
  assert.equal(
    await page.locator('.studio-titlebar-brand img, .studio-titlebar-brand svg').count(),
    0,
  )
  assert.equal(await page.locator('.studio-titlebar-name').textContent(), 'Dovo Studio')
  const glow = page.getByRole('slider', { name: 'Glow intensity', exact: true })
  const gradients = page.getByRole('switch', { name: 'Gradients', exact: true })
  const setGlow = async (value) => {
    await glow.fill(String(value))
    await page.waitForFunction(
      (value) => document.documentElement.dataset.themeGlow === String(value),
      value,
    )
  }
  assert.equal(await glow.inputValue(), '0', 'New workspaces default to quiet surfaces')
  assert.equal(await glow.getAttribute('aria-valuetext'), 'Off')
  assert.equal(await glow.locator('..').locator('output').textContent(), 'Off')
  assert.equal(await gradients.isChecked(), false)
  await setGlow(0.5)
  assert.equal(await glow.getAttribute('aria-valuetext'), '50 percent')
  assert.equal(await glow.locator('..').locator('output').textContent(), '50%')
  await gradients.click()
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
      // Navigation uses the palette's selection fill; filter-like choices keep
      // the neutral fill. Both retain the selected effects when enabled.
      await page.waitForFunction(() => {
        const probe = document.createElement('span')
        probe.style.backgroundColor = 'var(--studio-selected-fill)'
        probe.style.backgroundImage = 'var(--studio-selected-gradient)'
        probe.style.boxShadow = 'var(--studio-glow)'
        document.body.append(probe)
        const expected = getComputedStyle(probe)
        const neutralFill = expected.backgroundColor
        probe.style.backgroundColor = 'var(--selection)'
        const navigationFill = getComputedStyle(probe).backgroundColor
        const settled = [
          ...document.querySelectorAll(
            '[data-testid=effects] .studio-selected-surface, [data-testid=effects] .studio-nav-selected, [data-testid=effects] .studio-browser-tab[data-active], [data-testid=effects] .studio-thread-card, [data-testid=effects] .studio-thread-child',
          ),
        ].every((el) => {
          const selected = getComputedStyle(el)
          return (
            selected.backgroundColor ===
              (el.classList.contains('studio-selected-surface') ? neutralFill : navigationFill) &&
            ['backgroundImage', 'boxShadow'].every((key) => selected[key] === expected[key])
          )
        })
        probe.remove()
        return settled
      })
      const effects = await page.evaluate((primary) => {
        const probe = document.createElement('span')
        probe.style.color = 'color-mix(in srgb, ' + primary + ' 8%, transparent)'
        document.body.append(probe)
        const glow = getComputedStyle(probe).color
        probe.remove()
        const style = (selector) =>
          getComputedStyle(document.querySelector('[data-testid=effects] ' + selector))
        return {
          stopAccent: style('[data-composer-stop]').getPropertyValue('--primary').trim(),
          stopError: style('[data-composer-stop]').getPropertyValue('--destructive').trim(),
          intensity: document.documentElement.dataset.themeGlow,
          gradients: document.documentElement.dataset.themeGradients,
          primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
          tab: style('.studio-browser-tab').backgroundImage,
          tabShadow: style('.studio-browser-tab').boxShadow,
          rails: [
            ...document.querySelectorAll('[data-testid=effects] .studio-navigation-item'),
          ].map((el) => {
            const selected = getComputedStyle(el)
            const marker = getComputedStyle(el, '::before')
            return {
              background: selected.backgroundColor,
              image: selected.backgroundImage,
              shadow: selected.boxShadow,
              marker: marker.backgroundColor,
              markerWidth: marker.width,
              markerHeight: marker.height,
              markerContent: marker.content,
            }
          }),
          accent: (() => {
            probe.style.color = primary
            document.body.append(probe)
            const accent = getComputedStyle(probe).color
            probe.remove()
            return accent
          })(),
          threadEdgeWidth: style('.studio-thread-card').borderLeftWidth,
          navigationMarkers: [
            ...document.querySelectorAll(
              '[data-testid=effects] .studio-nav-selected, [data-testid=effects] .studio-browser-tab-select, [data-testid=effects] .studio-thread-card, [data-testid=effects] .studio-thread-child',
            ),
          ].map((el) => {
            const marker = getComputedStyle(el, '::before')
            return {
              color: marker.backgroundColor,
              width: marker.width,
              height: marker.height,
              content: marker.content,
            }
          }),
          sectionsMatch: [
            'backgroundImage',
            'borderColor',
            'borderRadius',
            'padding',
            'gap',
            'fontSize',
            'fontWeight',
            'marginBlock',
          ].every(
            (key) =>
              style('.studio-browser-sidebar .studio-list-section-header')[key] ===
              style('.studio-task-sidebar .studio-list-section-header')[key],
          ),
          dialog: style('.dovo-dialog-content').backgroundImage,
          dialogAction: style('.dovo-dialog-content button').color,
          glow,
        }
      }, expected.primary)
      assert.equal(
        effects.stopAccent,
        effects.stopError,
        id + ' ' + scheme + ' Stop retains the destructive accent',
      )
      assert.equal(effects.intensity, '0.5')
      assert.equal(effects.gradients, 'true')
      assert.equal(effects.primary, expected.primary)
      assert.match(effects.tab, /linear-gradient/)
      assert.ok(
        effects.tabShadow.includes(effects.glow),
        id + ' ' + scheme + ' glow uses the theme accent',
      )
      assert.ok(
        effects.rails.length === 2 &&
          effects.rails.every(
            (rail) =>
              rail.background === 'rgba(0, 0, 0, 0)' &&
              rail.image === 'none' &&
              rail.shadow === 'none' &&
              rail.marker === effects.accent &&
              rail.markerWidth === '2px' &&
              rail.markerHeight === '16px' &&
              rail.markerContent === '""',
          ),
        id +
          ' ' +
          scheme +
          ' active rails use visible accent edge markers: ' +
          JSON.stringify(effects.rails),
      )
      assert.equal(effects.threadEdgeWidth, '2px')
      assert.ok(
        effects.navigationMarkers.length === 4 &&
          effects.navigationMarkers.every(
            (marker) =>
              marker.color === effects.accent &&
              marker.width === '2px' &&
              marker.height === '16px' &&
              marker.content === '""',
          ),
        id +
          ' ' +
          scheme +
          ' navigation keeps 2px accent markers: ' +
          JSON.stringify(effects.navigationMarkers),
      )
      assert.ok(effects.sectionsMatch, id + ' ' + scheme + ' browser sections match threads')
      assert.equal(effects.dialog, 'none', 'Dialogs keep a calm, flat surface with effects enabled')
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
        const user = document.querySelector('.is-user .dovo-message-content')
        const terminal = window.terminals[0]
        return {
          background: root.getPropertyValue('--background').trim(),
          border: root.getPropertyValue('--border').trim(),
          statuses: ['success', 'error', 'done'].map((name) =>
            root.getPropertyValue('--status-' + name).trim(),
          ),
          icons: [...document.querySelector('[data-testid="pull-states"]').children].map(
            (el) => getComputedStyle(el).color,
          ),
          user: color(getComputedStyle(user).backgroundColor),
          neutralUser: color('color-mix(in srgb, var(--foreground) 5%, var(--background))'),
          userText: color(getComputedStyle(user).color),
          terminal: terminal.options.theme,
          buffer: terminal.viewport.lines.map((line) => line.text).join('\n'),
          sessions: window.sockets.length,
          dark: document.documentElement.classList.contains('dark'),
        }
      })
      const rgb = (hex) =>
        `rgb(${[1, 3, 5].map((pos) => parseInt(hex.slice(pos, pos + 2), 16)).join(', ')})`
      assert.equal(actual.background, expected.background, id + ' ' + scheme)
      assert.equal(actual.border, expected.border)
      assert.deepEqual(
        actual.icons,
        actual.statuses.map(rgb),
        'PR icons follow the selected status tokens',
      )
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
          .getByRole('button', { name: 'Start thread', exact: true })
          .evaluate((button) => getComputedStyle(button).color),
        rgb(expected['action-foreground']),
      )
      assert.equal(actual.user, actual.neutralUser, 'User messages use a neutral raised surface')
      assert.equal(actual.userText, rgb(expected.foreground))
      assert.equal(
        actual.terminal.background,
        expected.background,
        'Terminal uses the workspace canvas',
      )
      assert.equal(actual.terminal.foreground, expected.foreground)
      assert.equal(actual.sessions, 1, 'Changing themes must not reconnect the terminal')
      assert.ok(actual.buffer.includes('theme session preserved'))
      assert.equal(actual.dark, scheme === 'dark')
      await page.waitForFunction((expected) => {
        const token = [...document.querySelectorAll('[data-streamdown=code-block] span')].find(
          (span) => span.childElementCount === 0 && /^export\b/.test(span.textContent ?? ''),
        )
        return token && getComputedStyle(token).color === expected
      }, rgb(expected['syntax-keyword']))
      await page.waitForFunction((expected) => {
        const shadow = document.querySelector('[data-testid=diff] diffs-container')?.shadowRoot
        const token = [...(shadow?.querySelectorAll('span') ?? [])].find(
          (span) => span.childElementCount === 0 && /^export\b/.test(span.textContent ?? ''),
        )
        return token && getComputedStyle(token).color === expected
      }, rgb(expected['syntax-keyword']))
      await page.waitForFunction(() => {
        const host = document.querySelector('[data-testid=diff] diffs-container')
        if (!host) return false
        const diff = getComputedStyle(host),
          root = getComputedStyle(document.documentElement)
        return (
          diff.getPropertyValue('--diffs-addition-color-override').trim() ===
            root.getPropertyValue('--status-success').trim() &&
          diff.getPropertyValue('--diffs-deletion-color-override').trim() ===
            root.getPropertyValue('--status-error').trim()
        )
      })
      if (
        process.env.DOVO_APPEARANCE_SCREENSHOT &&
        ['dovo', 'nord', 'rose-pine', 'sand'].includes(id)
      )
        await page.screenshot({
          path: process.env.DOVO_APPEARANCE_SCREENSHOT.replace('.png', `-${id}-${scheme}.png`),
        })
    }
  }
  const assertForcedColorMarkers = async (scheme) => {
    const markers = await page.locator('[data-testid=effects]').evaluate((preview) => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'Highlight'
      probe.style.forcedColorAdjust = 'none'
      document.body.append(probe)
      const highlight = getComputedStyle(probe).backgroundColor
      probe.remove()
      return [
        ...preview.querySelectorAll(
          '.studio-navigation-item, .studio-nav-selected, .studio-browser-tab-select, .studio-thread-card, .studio-thread-child, .studio-settings-target',
        ),
      ].map((element) => {
        const marker = getComputedStyle(element, '::before')
        return {
          color: marker.backgroundColor,
          highlight,
          width: marker.width,
          height: marker.height,
          content: marker.content,
          target: element.classList.contains('studio-settings-target'),
        }
      })
    })
    assert.ok(
      markers.length === 7 &&
        markers.every(
          (marker) =>
            marker.color === marker.highlight &&
            marker.width === '2px' &&
            (marker.target ? parseFloat(marker.height) > 0 : marker.height === '16px') &&
            marker.content === '""',
        ),
      scheme +
        ' selected navigation and target markers survive forced colors: ' +
        JSON.stringify(markers),
    )
  }
  for (const scheme of ['light', 'dark']) {
    await mode(scheme === 'dark' ? 'Dark' : 'Light')
    await page.emulateMedia({ forcedColors: 'active' })
    const selections = await page
      .locator(
        '[data-testid=effects] .studio-selected-surface, [data-testid=effects] .studio-nav-selected, [data-testid=effects] .studio-navigation-item, [data-testid=effects] .studio-browser-tab[data-active], [data-testid=effects] .studio-thread-child, [data-composer-stop]',
      )
      .evaluateAll((elements) =>
        elements.map((el) => ({
          shadow: getComputedStyle(el).boxShadow,
          background: getComputedStyle(el).backgroundImage,
          border: getComputedStyle(el).borderColor,
        })),
      )
    assert.ok(
      selections.every(
        (style) =>
          style.shadow === 'none' &&
          style.background === 'none' &&
          style.border !== 'rgba(0, 0, 0, 0)',
      ),
      scheme + ' selections stay visible without decorative effects in forced colors',
    )
    await assertForcedColorMarkers(scheme)
    await page.emulateMedia({ forcedColors: 'none' })
  }
  await choose('Claude')
  await mode('System')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await mode('Dark')
  await setGlow(0.5)
  await page.waitForFunction(() =>
    getComputedStyle(
      document.querySelector('[data-testid=effects] .studio-browser-tab'),
    ).boxShadow.includes('7px'),
  )
  await page.reload()
  await ready()
  assert.equal(await glow.inputValue(), '0.5', 'Intermediate glow intensity survives reload')
  await setGlow(0)
  assert.match(
    await page
      .locator('[data-testid=effects] .studio-browser-tab')
      .evaluate((el) => getComputedStyle(el).backgroundImage),
    /linear-gradient/,
    'Glow can be disabled independently of gradients',
  )
  await gradients.click()
  const checkFlatEffects = async () => {
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.themeGradients === 'false' &&
        document.documentElement.dataset.themeGlow === '0',
    )
    // Filled buttons animate their shadow; wait for the rendered endpoint.
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid=effects] button')].every(
        (el) => getComputedStyle(el).boxShadow === 'none',
      ),
    )
    const surfaces = await page.locator('[data-testid=effects]').evaluate((preview) =>
      [
        ...preview.querySelectorAll(
          '.studio-navigation-item, .studio-browser-tab, .studio-thread-card, .studio-selected-surface, .studio-composer, .studio-composer button, .dovo-dialog-content, .dovo-dialog-content button',
        ),
      ].map((el) => ({
        element: el.className,
        background: getComputedStyle(el).backgroundImage,
        fill: getComputedStyle(el).backgroundColor,
        shadow: getComputedStyle(el).boxShadow,
      })),
    )
    assert.ok(
      surfaces.every((surface) => surface.background === 'none'),
      'Flat mode removes decorative gradients',
    )
    const selectedTab = surfaces.find((surface) => surface.element === 'studio-browser-tab')
    assert.ok(selectedTab, 'Fixture includes a selected browser tab')
    assert.notEqual(selectedTab.fill, 'rgba(0, 0, 0, 0)', 'Selected tabs retain a solid fill')
    assert.ok(
      surfaces.every((surface) => surface.shadow === 'none'),
      'Zero glow removes all decorative surface shadows: ' + JSON.stringify(surfaces),
    )
  }
  await checkFlatEffects()
  await choose('Nord')
  await mode('Dark')
  await checkFlatEffects()
  await page.reload()
  await ready()
  assert.equal(
    await gradients.isChecked(),
    false,
    'Effects preference survives reload and palette changes',
  )
  assert.equal(await glow.inputValue(), '0')
  await checkFlatEffects()
  await page.getByRole('textbox', { name: 'Effects composer', exact: true }).focus()
  assert.notEqual(
    await page
      .locator('[data-testid=effects] .studio-composer')
      .evaluate((el) => getComputedStyle(el).borderColor),
    'rgba(0, 0, 0, 0)',
    'Composer focus stays visible with effects disabled',
  )
  await gradients.click()
  await setGlow(1)
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.themeGradients === 'true' &&
      document.documentElement.dataset.themeGlow === '1' &&
      getComputedStyle(
        document.querySelector('[data-testid=effects] .studio-browser-tab'),
      ).backgroundImage.includes('linear-gradient'),
  )
  for (const scheme of ['light', 'dark']) {
    await mode(scheme === 'dark' ? 'Dark' : 'Light')
    await page.emulateMedia({ forcedColors: 'active' })
    const selections = await page
      .locator(
        '[data-testid=effects] .studio-selected-surface, [data-testid=effects] .studio-nav-selected, [data-testid=effects] .studio-navigation-item, [data-testid=effects] .studio-browser-tab[data-active], [data-testid=effects] .studio-thread-child, [data-composer-stop]',
      )
      .evaluateAll((elements) =>
        elements.map((el) => ({
          shadow: getComputedStyle(el).boxShadow,
          background: getComputedStyle(el).backgroundImage,
          border: getComputedStyle(el).borderColor,
        })),
      )
    assert.ok(
      selections.every(
        (style) =>
          style.shadow === 'none' &&
          style.background === 'none' &&
          style.border !== 'rgba(0, 0, 0, 0)',
      ),
      scheme + ' selections stay visible without decorative effects in forced colors',
    )
    await assertForcedColorMarkers(scheme)
    await page.emulateMedia({ forcedColors: 'none' })
  }
  await choose('Claude')
  await mode('System')
  await page.reload()
  await ready()
  assert.equal(
    await page.getByRole('radio', { name: 'Claude', exact: true, includeHidden: true }).isChecked(),
    true,
  )
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.getByRole('combobox', { name: 'App font', exact: true }).fill('Georgia')
  const fontPreviews = page.getByRole('group', { name: 'Font previews', exact: true })
  assert.ok(
    await fontPreviews
      .getByText('A clear view of your next idea.', { exact: true })
      .evaluate((el) => getComputedStyle(el).fontFamily.startsWith('Georgia')),
  )
  assert.doesNotMatch(
    await page.getByRole('region', { name: 'Terminal font preview', exact: true }).innerText(),
    /[\uE000-\uF8FF]/,
    'System font preview uses ordinary characters without unsupported private-use glyphs',
  )
  await page
    .getByRole('combobox', { name: 'Code font', exact: true })
    .fill('JetBrains Mono Nerd Font')
  assert.ok(
    await fontPreviews
      .locator('code')
      .evaluate((el) => getComputedStyle(el).fontFamily.includes('JetBrains Mono Nerd Font')),
  )
  await page
    .getByRole('combobox', { name: 'Terminal font', exact: true })
    .fill('JetBrains Mono Nerd Font')
  assert.match(
    await page.getByRole('region', { name: 'Terminal font preview', exact: true }).innerText(),
    /[\uE000-\uF8FF]/,
    'Bundled Nerd Font preview includes its developer icons',
  )
  const terminalSize = page.getByRole('spinbutton', { name: 'Terminal font size', exact: true })
  const decreaseSize = page.getByRole('button', {
    name: 'Decrease terminal font size',
    exact: true,
  })
  const increaseSize = page.getByRole('button', {
    name: 'Increase terminal font size',
    exact: true,
  })
  for (const viewport of [
    { width: 1280, height: 1000 },
    { width: 390, height: 480 },
  ]) {
    await page.setViewportSize(viewport)
    await terminalSize.scrollIntoViewIfNeeded()
    const stepperGeometry = await terminalSize.evaluate((input) => {
      const bounds = input.parentElement.getBoundingClientRect()
      const control = input.closest('.studio-setting-control').getBoundingClientRect()
      return {
        width: bounds.width,
        controlWidth: control.width,
        insideViewport:
          bounds.left >= -1 &&
          bounds.top >= -1 &&
          bounds.right <= innerWidth + 1 &&
          bounds.bottom <= innerHeight + 1,
      }
    })
    assert.equal(
      stepperGeometry.width,
      stepperGeometry.controlWidth,
      'Terminal font stepper fills the shared settings control width',
    )
    assert.ok(stepperGeometry.insideViewport, 'Terminal font stepper fits the viewport')
  }
  await page.setViewportSize({ width: 1280, height: 1000 })
  for (let size = 8; size <= 32; size++) {
    await terminalSize.fill(String(size))
    await page.waitForFunction((size) => window.terminals[0].options.fontSize === size, size)
  }
  assert.equal(await increaseSize.isDisabled(), true)
  await decreaseSize.click()
  assert.equal(await terminalSize.inputValue(), '31')
  await terminalSize.press('ArrowUp')
  assert.equal(await terminalSize.inputValue(), '32')
  await terminalSize.fill('8')
  assert.equal(await decreaseSize.isDisabled(), true)
  await increaseSize.click()
  assert.equal(await terminalSize.inputValue(), '9')
  await terminalSize.press('ArrowDown')
  assert.equal(await terminalSize.inputValue(), '8')
  await terminalSize.fill('18')
  for (const invalid of ['', '7', '33', '18.5', '-1']) {
    await terminalSize.fill(invalid)
    assert.equal(await terminalSize.getAttribute('aria-invalid'), 'true')
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('dovo.app-preferences.v1')).terminalFontSize,
      ),
      18,
      'Invalid terminal sizes never change saved preferences',
    )
    assert.equal(await page.evaluate(() => window.terminals[0].options.fontSize), 18)
    await terminalSize.blur()
    assert.equal(
      await terminalSize.inputValue(),
      '18',
      'Leaving an invalid entry restores the saved size',
    )
  }
  await terminalSize.fill('33')
  await terminalSize.press('Escape')
  assert.equal(await terminalSize.inputValue(), '18')
  await terminalSize.fill('')
  await terminalSize.press('Enter')
  assert.equal(await terminalSize.inputValue(), '18')
  await terminalSize.fill('32')
  await terminalSize.press('Enter')
  await page.waitForFunction(
    () =>
      window.terminals[0].options.fontSize === 32 &&
      window.terminals[0].options.fontFamily.includes('JetBrains Mono Nerd Font'),
  )
  const fontState = await page.evaluate(async () => {
    // Terminal fonts now load in the worker's FontFaceSet. Exercise both DOM
    // font weights explicitly for the code-font and bundled-glyph assertions.
    await Promise.all([
      document.fonts.load('18px "JetBrains Mono Nerd Font"'),
      document.fonts.load('bold 18px "JetBrains Mono Nerd Font"'),
    ])
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
      buffer: window.terminals[0].viewport.lines.map((line) => line.text).join('\n'),
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
  if (process.env.DOVO_APPEARANCE_SCREENSHOT) {
    await fontPreviews.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: process.env.DOVO_APPEARANCE_SCREENSHOT.replace('.png', '-fonts.png'),
    })
  }
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
  await page.waitForFunction(() => window.terminals[0].options.fontSize === 32)
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
  await openPalettes()
  await page.getByRole('radio', { name: 'Claude', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('radio', { name: 'T3 Code', exact: true }).isChecked(), true)
  await browsePalettes.click()
  assert.equal(
    await page
      .getByRole('img', { name: 'Current color palette: T3 Code', exact: true })
      .isVisible(),
    true,
  )
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
    for (const preview of [
      fontPreviews,
      page.getByRole('region', { name: 'Terminal font preview', exact: true }),
    ])
      assert.ok(
        await preview.evaluate((el) => el.clientWidth <= el.parentElement.clientWidth),
        `Font previews fit ${width}px screens`,
      )
    assert.ok(
      await page
        .getByRole('combobox', { name: 'Color scheme', exact: true })
        .evaluate((control) => {
          const buttons = control.getBoundingClientRect()
          const label = control.parentElement.previousElementSibling.getBoundingClientRect()
          return buttons.left >= label.right || buttons.top >= label.bottom
        }),
      'Color scheme buttons must not overlap their description at ' +
        width +
        ': ' +
        JSON.stringify(
          await page
            .getByRole('combobox', { name: 'Color scheme', exact: true })
            .evaluate((control) => ({
              control: control.getBoundingClientRect().toJSON(),
              label: control.parentElement.previousElementSibling.getBoundingClientRect().toJSON(),
            })),
        ),
    )
  }
  await page.setViewportSize({ width: 390, height: 844 })
  if (process.env.DOVO_APPEARANCE_SCREENSHOT)
    await page.screenshot({ path: process.env.DOVO_APPEARANCE_SCREENSHOT })
  await page.setViewportSize({ width: 1280, height: 900 })
  const chooseCode = async (name) => {
    await page.getByRole('combobox', { name: 'Code theme', exact: true }).click()
    await page.getByRole('option', { name, exact: true }).click()
  }
  await chooseCode('Dracula')
  const selectedPalette = await page.locator('html').getAttribute('data-theme-palette')
  const theme = JSON.stringify({
    name: 'Imported Proof',
    type: 'light',
    colors: { 'editor.background': '#fefdfa', 'editor.foreground': '#123456' },
    tokenColors: [{ scope: 'keyword', settings: { foreground: '#c02d69' } }],
  })
  await page.getByLabel('VS Code theme file', { exact: true }).setInputFiles({
    name: 'proof.jsonc',
    mimeType: 'application/json',
    buffer: Buffer.from('// VS Code theme\n' + theme),
  })
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem('dovo.app-preferences.v1')).codeTheme.startsWith(
      'dovo-import-',
    ),
  )
  await page.waitForFunction(() => {
    const shadow = document.querySelector('[data-testid=diff] diffs-container')?.shadowRoot
    const token = [...(shadow?.querySelectorAll('span') ?? [])].find(
      (span) => span.childElementCount === 0 && /^export\b/.test(span.textContent ?? ''),
    )
    return token && getComputedStyle(token).color === 'rgb(192, 45, 105)'
  })
  assert.equal(await page.locator('html').getAttribute('data-theme-palette'), selectedPalette)
  if (process.env.DOVO_CODE_THEME_SCREENSHOT) {
    await page.getByRole('combobox', { name: 'Code theme', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.DOVO_CODE_THEME_SCREENSHOT })
  }
  await page.reload()
  await ready()
  await page
    .getByRole('combobox', { name: 'Code theme', exact: true })
    .getByText('Imported Proof (light)', { exact: true })
    .waitFor()
  await page.getByLabel('VS Code theme file', { exact: true }).setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"include":"base.json"}'),
  })
  await page
    .getByRole('alert')
    .getByText(/Generate Color Theme/)
    .waitFor()
  assert.ok(
    await page
      .getByRole('combobox', { name: 'Code theme', exact: true })
      .textContent()
      .then((text) => text.includes('Imported Proof')),
  )
  await page.getByRole('button', { name: 'Remove theme', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Code theme', exact: true })
    .getByText('Follow app', { exact: true })
    .waitFor()
  await exerciseThemeBrowser(page, catalog, { mobile: false })
  await page.reload()
  await ready()
  await page
    .getByRole('combobox', { name: 'Code theme', exact: true })
    .getByText('Aurora Dark (dark)', { exact: true })
    .waitFor()
  assert.deepEqual(errors, [])
  console.log(
    `Appearance: all ${ids.length * 2} palette/mode combinations, markdown/diff syntax, font persistence, bundled Nerd glyphs, terminal continuity, system mode, persistence, keyboard selection, text-only titlebar and narrow layout passed.`,
  )
} finally {
  await browser.close()
  await vite.close()
}
