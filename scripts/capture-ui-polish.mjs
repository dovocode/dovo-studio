import assert from 'node:assert/strict'
import { captureFollowUpDialogs } from './ui-polish-dialogs.mjs'
import { build } from 'esbuild'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { WebSocketServer } from 'ws'
import { encodeTerminalStreamFrame } from '../packages/protocol/dist/index.js'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Production screen compositions; only workspace reads come from the existing catalog fixture.
const root = fileURLToPath(new URL('../', import.meta.url))
const all = process.argv.includes('--all')
const manifest = []
const output = resolve(process.argv[2] ?? '/tmp/dovo-ui-polish')
await mkdir(output, { recursive: true })
const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
})
await server.listen()
const origin = `http://127.0.0.1:${server.httpServer.address().port}`
const sockets = new WebSocketServer({ noServer: true })
server.httpServer.on('upgrade', (request, socket, head) => {
  if (new URL(request.url, origin).pathname === '/ws/terminal')
    sockets.handleUpgrade(request, socket, head, (peer) =>
      sockets.emit('connection', peer, request),
    )
})
sockets.on('connection', (socket) => {
  for (const frame of [
    { type: 'replayStart' },
    {
      type: 'data',
      data: new TextEncoder().encode(
        '\x1b[36m~/dovo-studio\x1b[0m on main\r\n$ git status --short\r\n M src/navigation.tsx\r\n M README.md\r\n\r\n$ ',
      ),
    },
    { type: 'replayEnd' },
  ])
    socket.send(encodeTerminalStreamFrame(frame))
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'ping')
      socket.send(encodeTerminalStreamFrame({ type: 'pong', nonce: message.nonce }))
  })
})
let browser
try {
  const built = await build({
    stdin: {
      resolveDir: root + 'apps/design-system',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {DesktopScreen,desktopScreenViews} from './src/desktop-screens.stories';
import {DesktopFollowUp} from './src/desktop-dialogs-fixture';
import {PullDetail} from '../../packages/extension-scm/src/pulls/detail/detail';
window.uiRoutes=desktopScreenViews.map(({id,title})=>({id,title}));
import {updateAppPreferences} from '@dovo/studio-core';
window.uiSetPreferences=updateAppPreferences;
import {useAppearance} from '../../packages/studio-shell/src/appearance';
const query=new URLSearchParams(location.search);
updateAppPreferences({theme:query.get('mode')==='light'?'light':'dark',browserWorkspaceEnabled:true});
function App(){useAppearance();const surface=query.get('surface');return <DesktopScreen route={query.get('route')??'tasks'} entityId={query.get('thread')??undefined} state={query.has("git-dense")?"git-review-dense":query.has("dense")?"lists-dense":query.has("changes")?"git-changes":query.has("legacy")?"legacy":query.has("idle")?"idle":query.get("busy")==="long-draft"?"busy-long-draft":query.has("busy")?"busy":"populated"} overlay={query.has("dialog")?<DesktopFollowUp name={query.get("dialog")}/>:undefined}>{surface?.startsWith('pull-')?<PullDetail repositoryId="preview-project" number={42} initialTab={surface.slice(5)} onBack={()=>{}} onChanged={()=>{}}/>:undefined}</DesktopScreen>}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    plugins: [
      {
        name: 'terminal-worker-location',
        setup(builder) {
          builder.onLoad({ filter: /composer-fixture\.tsx$/ }, async ({ path }) => ({
            contents: (await readFile(path, 'utf8')).replace('http://preview.local:51464', origin),
            loader: 'tsx',
          }))
          builder.onLoad({ filter: /terminal\/src\/browser\/terminal\.ts$/ }, async ({ path }) => ({
            contents: (await readFile(path, 'utf8')).replace(
              "new URL('./terminal.worker.ts', import.meta.url)",
              "new URL('/packages/terminal/src/browser/terminal.worker.ts', import.meta.url)",
            ),
            loader: 'ts',
          }))
        },
      },
    ],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    platform: 'browser',
    loader: { '.css': 'empty', '.png': 'dataurl', '.woff2': 'dataurl', '.md': 'text' },
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.url': JSON.stringify(origin + '/entry.mjs'),
    },
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
  })
  const css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
  const taskCSS = (await server.transformRequest('/packages/extension-tasks/src/styles.css?direct'))
    .code
  browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  })
  await page.addInitScript(() => {
    // Image and export editors own sandboxed frames; reset only this catalog's top-level page.
    if (window.top !== window) return
    localStorage.clear()
    sessionStorage.clear()
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(origin + '/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/entry.mjs')
      return route.fulfill({ contentType: 'text/javascript', body: built.outputFiles[0].text })
    if (path === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><title>Dovo UI review</title><style>${css}\n${taskCSS}</style></head><body><div id="app"></div><script type="module" src="/entry.mjs"></script></body></html>`,
      })
    return route.continue()
  })
  await page.goto(origin + '/?mode=dark&route=tasks')
  const routes = await page.evaluate(() => window.uiRoutes)
  const screens = process.argv.includes('--dialogs-only')
    ? []
    : [
        ['welcome', 'tasks'],
        ['conversation', 'tasks', 'preview-task'],
        ['busy-conversation', 'tasks', 'preview-task', undefined, 'busy'],
        ['busy-unified-workspace', 'tasks', 'preview-task', 'unified', 'busy'],
        ['busy-long-draft', 'tasks', 'preview-task', undefined, 'busy-long-draft'],
        ['busy-mid-scroll', 'tasks', 'preview-task', 'mid-scroll', 'busy'],
        ['busy-sections', 'tasks', 'preview-task', undefined, 'busy'],
        ['pulls', 'pulls'],
        ['pulls-dense', 'pulls', undefined, undefined, 'lists-dense'],
        ['pulls-dense-row-menu', 'pulls', undefined, 'dense-row-menu', 'lists-dense'],
        ['issues-dense', 'issues', undefined, undefined, 'lists-dense'],
        ['agents-dirty', 'agents', undefined, 'agents-dirty'],
        ['settings', 'general'],
        ...(all
          ? [
              ...routes
                .filter(({ id }) => !['tasks', 'pulls', 'general'].includes(id))
                .map(({ id }) => [id, id]),
              ...['agents', 'task-behavior', 'remote-desktop'].map((route) => [
                route + '-legacy',
                route,
                undefined,
                undefined,
                'legacy',
              ]),
              ...['overview', 'changes', 'checks'].map((tab) => [
                'pull-' + tab,
                'pulls',
                undefined,
                'pull-' + tab,
              ]),
              ...['Files', 'Linked projects', 'Side chats', 'Browsers', 'Devices'].map((tool) => [
                tool.toLowerCase().replaceAll(' ', '-') + '-panel',
                'tasks',
                'preview-task',
                tool,
              ]),
              ['thread-info', 'tasks', 'preview-task', 'info'],
              ['terminal', 'tasks', 'preview-task', 'terminal'],
              ['unified-workspace', 'tasks', 'preview-task', 'unified'],
            ]
          : []),
      ]
  for (const mode of ['dark', 'light'])
    for (const [name, route, thread, action, state] of screens.filter(
      ([name]) =>
        !process.argv.some((arg) => arg.startsWith('--only=')) ||
        process.argv
          .find((arg) => arg.startsWith('--only='))
          .slice(7)
          .split(',')
          .includes(name),
    )) {
      await page.goto(
        `${origin}/?mode=${mode}&route=${route}${thread ? '&thread=' + thread : ''}${action?.startsWith('pull-') ? '&surface=' + action : ''}${state === 'lists-dense' ? '&dense' : state === 'legacy' ? '&legacy' : state === 'busy-long-draft' ? '&busy=long-draft' : state === 'busy' ? '&busy' : ''}`,
      )
      await page.locator('.studio').waitFor()
      await page.waitForFunction(() => !document.body.innerText.includes('Loading extension…'))
      if (route === 'tasks') {
        await page
          .getByRole('textbox', { name: 'Message thread', exact: true })
          .waitFor({ state: 'visible' })
      }
      if (
        action &&
        !action.startsWith('pull-') &&
        !['mid-scroll', 'agents-dirty', 'dense-row-menu'].includes(action)
      ) {
        if (['terminal', 'unified'].includes(action))
          await page.getByRole('button', { name: 'Show bottom terminal', exact: true }).click()
        if (action === 'info') {
          const info = page.getByRole('button', { name: 'Show thread info', exact: true })
          if (await info.count()) await info.click()
        } else if (action !== 'terminal')
          await page
            .getByRole('navigation', { name: 'Thread tools' })
            .getByRole('button', { name: action === 'unified' ? 'Files' : action, exact: true })
            .click()
      }
      await page.mouse.move(0, 0)
      if (['terminal', 'unified'].includes(action)) {
        await page.locator('[data-terminal-session] canvas').first().waitFor({ state: 'visible' })
        assert.ok(
          (await page.locator('[data-terminal-session]').first().boundingBox()).height > 100,
          'Bottom terminal remains visible alongside tools',
        )
      }
      if (['terminal', 'unified'].includes(action)) {
        await page.waitForFunction(() =>
          document
            .querySelector('.dovo-terminal-accessible')
            ?.textContent.includes('src/navigation.tsx'),
        )
      }
      await page.waitForFunction(
        () =>
          !['Loading activity…', 'Loading provider models…'].some((text) =>
            document.body.innerText.includes(text),
          ),
      )
      if (state === 'lists-dense') {
        if (route === 'pulls') {
          const menus = page.getByRole('button', { name: /^Actions for PR #/ })
          await menus.first().waitFor()
          assert.equal(
            await menus.count(),
            14,
            'Dense PR fixture contains fourteen production rows',
          )
          if (action === 'dense-row-menu') {
            await menus.first().click()
            await page.getByRole('menuitem', { name: 'Copy PR link', exact: true }).waitFor()
          }
        } else {
          await page
            .getByRole('button')
            .filter({ hasText: 'Reconnect to a paired computer' })
            .waitFor()
          assert.equal(
            await page.locator('button.studio-collection-row').count(),
            14,
            'Dense issue fixture contains fourteen production rows',
          )
        }
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          'Dense lists stay within the page viewport',
        )
      }
      if (action === 'agents-dirty') {
        await page.getByLabel('Name', { exact: true }).fill('Runtime navigation reviewer')
        await page
          .getByLabel('Instructions', { exact: true })
          .fill(
            'Review the runtime selection and reconnect flow. Preserve HTTP access over LAN and VPN, and verify unsaved drafts remain available when switching project tools.',
          )
        await page.getByText('Connection & account', { exact: true }).click()
        const region = page.getByRole('region', { name: 'Agents settings', exact: true })
        await region.evaluate((element) => {
          element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.45
        })
        const actions = page.getByRole('group', { name: 'Settings save actions', exact: true })
        await actions
          .getByRole('button', { name: 'Save changes', exact: true })
          .waitFor({ state: 'visible' })
        await actions
          .getByRole('button', { name: 'Discard', exact: true })
          .waitFor({ state: 'visible' })
        const bounds = await actions.boundingBox()
        assert.ok(
          bounds && bounds.y >= 0 && bounds.y + bounds.height <= 960,
          'Unsaved agent actions remain visible while settings scroll',
        )
        assert.equal(
          await page.getByRole('dialog').count(),
          0,
          'Agent draft uses the embedded settings editor',
        )
      }
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction(() => {
        const navigation = document.querySelector('[aria-label="Settings navigation"]')
        const selected = navigation?.querySelector('[aria-current="page"]')
        if (!navigation || !selected) return true
        const area = navigation.getBoundingClientRect(),
          item = selected.getBoundingClientRect()
        return item.top >= area.top && item.bottom <= area.bottom - 16
      })
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.effect?.getComputedTiming().iterations === Infinity ||
              ['finished', 'idle', 'paused'].includes(a.playState),
          ),
      )
      const alerts = await page.getByRole('alert').allTextContents()
      if (!all) assert.deepEqual(alerts, [], `${name}: no preview errors`)
      if (state?.startsWith('busy')) {
        const text = await page.locator('body').innerText()
        for (const expected of [
          'Client portal',
          'Operations API',
          'Review checklist',
          'PR #42',
          '2 queued messages',
        ])
          assert.ok(text.includes(expected), `${name}: busy workspace includes ${expected}`)
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${name}: no page overflow`,
        )
      }
      if (name === 'busy-sections') {
        for (const [label, expanded] of [
          ['Open', false],
          ['Needs input', true],
          ['Waiting', true],
          ['Snoozed', true],
        ]) {
          const summary = page
            .locator('summary')
            .filter({ hasText: new RegExp('^' + label) })
            .first()
          await summary.waitFor()
          if ((await summary.evaluate((element) => element.parentElement.open)) !== expanded)
            await summary.click()
          assert.equal(await summary.evaluate((element) => element.parentElement.open), expanded)
        }
      }
      if (name === 'busy-long-draft') {
        const editor = page.getByRole('textbox', { name: 'Message thread', exact: true })
        assert.equal(
          (await editor.innerText()).split('\n').filter((line) => line.trim()).length,
          3,
          'Draft contains three real text lines',
        )
        const [input, attachment, footer, surface] = await Promise.all([
          editor.boundingBox(),
          page.getByLabel('Draft attachments', { exact: true }).boundingBox(),
          page.locator('[data-composer-footer]').boundingBox(),
          page.locator('.studio-composer').boundingBox(),
        ])
        const lineHeight = await editor.evaluate((element) =>
          parseFloat(getComputedStyle(element).lineHeight),
        )
        assert.ok(input.height >= lineHeight * 3 - 1, 'Editor displays all three draft lines')
        assert.ok(attachment.height > 0, 'Draft attachment is visible')
        assert.ok(
          attachment.y + attachment.height <= input.y + 1 ||
            input.y + input.height <= attachment.y + 1,
          'Draft editor and attachment chip do not overlap',
        )
        assert.ok(
          input.y + input.height <= footer.y + 1,
          'Draft editor remains above composer controls',
        )
        for (const box of [input, attachment, footer])
          assert.ok(
            box.y >= surface.y - 1 && box.y + box.height <= surface.y + surface.height + 1,
            'Draft content stays within the composer',
          )
      }
      if (name === 'busy-mid-scroll') {
        const viewport = page.locator('.studio-conversation-content').locator('..')
        const area = await viewport.boundingBox()
        const range = await viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        )
        assert.ok(
          area.height > 200 && range > 200,
          'Conversation has a useful scroll viewport and overflow',
        )
        await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
        await page.mouse.wheel(0, -Math.round(range / 2))
        await page.waitForFunction(() => {
          const viewport = document.querySelector('.studio-conversation-content')?.parentElement
          return (
            viewport &&
            viewport.scrollTop > 10 &&
            viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight - 10
          )
        })
        const geometry = await viewport.evaluate((element) => {
          const content = element.firstElementChild.getBoundingClientRect()
          const view = element.getBoundingClientRect()
          return {
            overflow: getComputedStyle(element).overflowY,
            topClipped: content.top < view.top,
            bottomClipped: content.bottom > view.bottom,
          }
        })
        assert.ok(
          ['auto', 'scroll'].includes(geometry.overflow),
          'Conversation clips within its normal scroll viewport',
        )
        assert.ok(
          geometry.topClipped && geometry.bottomClipped,
          'Mid-scroll content extends beyond both viewport boundaries',
        )
        const composer = await page.locator('.task-composer').boundingBox()
        assert.ok(
          area.y + area.height <= composer.y + 1,
          'Scroll viewport remains above the composer; clipped content is expected',
        )
        await page
          .getByRole('button', { name: 'Scroll to latest message', exact: true })
          .waitFor({ state: 'visible' })
        await page.mouse.move(0, 0)
      }
      if (name.startsWith('busy-')) {
        const turnTargets = page
          .getByRole('navigation', { name: 'Conversation turns', exact: true })
          .getByRole('button')
        for (const target of await turnTargets.all()) {
          const bounds = await target.boundingBox()
          assert.ok(
            bounds && bounds.height >= 24 && bounds.width >= 24,
            'Turn navigation has accessible pointer targets',
          )
        }
      }
      const controls = await page
        .locator('button, input, textarea, select, [role="switch"], [role="tab"]')
        .evaluateAll((elements) =>
          elements.map((element) => ({
            role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
            label:
              element.getAttribute('aria-label') ??
              element.getAttribute('title') ??
              element.textContent?.trim(),
            disabled: element.matches(':disabled, [aria-disabled="true"]'),
          })),
        )
      manifest.push({
        name,
        mode,
        route,
        alerts,
        controls,
        text: await page.locator('body').innerText(),
      })
      assert.equal(await page.evaluate(() => document.fonts.check('400 14px Inter')), true)
      assert.equal(Math.round((await page.locator('.studio').boundingBox()).height), 960)
      assert.ok(
        (
          await page
            .getByRole('navigation', { name: 'Main navigation', exact: true, includeHidden: true })
            .boundingBox()
        ).width <= 64,
        'Activity bar stays thin',
      )
      if (mode === 'dark')
        assert.equal(
          await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
          ),
          '#080808',
        )
      if (route === 'tasks' && name !== 'busy-long-draft') {
        const placeholder = await page
          .getByRole('textbox', { name: 'Message thread', exact: true })
          .evaluate((el) => getComputedStyle(el, '::before').content)
        assert.ok(placeholder.length > 2 && placeholder !== 'none', 'Writing prompt is visible')
      }
      await writeFile(
        resolve(output, 'manifest.json'),
        JSON.stringify({ screens: manifest, errors }, null, 2),
      )
      await page.screenshot({
        path: resolve(output, `${name}-${mode}.png`),
        animations: 'disabled',
      })
      if (name === 'conversation') {
        const files = page
          .getByRole('navigation', { name: 'Thread tools' })
          .getByRole('button', { name: 'Files', exact: true })
        await files.hover()
        await page.getByRole('tooltip', { name: 'Files', exact: true }).waitFor()
        await page
          .getByRole('tooltip', { name: 'Files', exact: true })
          .evaluate(async (element) => {
            await Promise.all(
              element.getAnimations({ subtree: true }).map((animation) => animation.finished),
            )
          })
        await page.screenshot({ path: resolve(output, `tools-tooltip-${mode}.png`) })
        await page.mouse.move(0, 0)
        await page.keyboard.press('Escape')
        await page.getByRole('tooltip').waitFor({ state: 'hidden' })
        await files.focus()
        assert.equal(await files.evaluate((el) => document.activeElement === el), true)
        await page.keyboard.press('Tab')
        await page.getByRole('button', { name: 'Linked projects', exact: true }).waitFor()
        await page.evaluate(() => document.activeElement?.blur())
        await page.keyboard.press('Escape')
        await page.mouse.move(0, 0)
        await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'))
        const browserNavigation = page
          .getByRole('navigation', { name: 'Main navigation', exact: true })
          .getByRole('button', { name: 'Browser', exact: true })
        await browserNavigation.hover()
        await page.getByRole('tooltip', { name: 'Browser', exact: true }).waitFor()
        await page
          .getByRole('tooltip', { name: 'Browser', exact: true })
          .evaluate(async (element) => {
            await Promise.all(
              element.getAnimations({ subtree: true }).map((animation) => animation.finished),
            )
          })
        await page.screenshot({ path: resolve(output, `navigation-tooltip-${mode}.png`) })
        await page.mouse.move(0, 0)
        await page.keyboard.press('Escape')
        await page.getByRole('tooltip').waitFor({ state: 'hidden' })
      }
      if (name === 'welcome' || name === 'conversation') {
        await page.setViewportSize({ width: 1100, height: 960 })
        await page.screenshot({ path: resolve(output, `${name}-compact-${mode}.png`) })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await page.setViewportSize({ width: 1440, height: 960 })
      }
      if (name === 'appearance' && process.argv.includes('--controls')) {
        const palettes = page.locator('details[data-setting-label="Color palette choices"]')
        await palettes.locator('summary').click()
        assert.equal(await palettes.getByRole('radio').count(), 17)
        await palettes.evaluate((element) => element.scrollIntoView({ block: 'start' }))
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: resolve(output, `appearance-palettes-${mode}.png`) })
        await palettes.locator('summary').click()
        assert.equal(await palettes.getAttribute('open'), null)
      }
      if (process.argv.includes('--controls')) {
        const control =
          name === 'conversation'
            ? page.getByRole('button', { name: 'Choose agent and model', exact: true })
            : name === 'pulls'
              ? page.getByRole('button', { name: 'Actions for PR #42', exact: true })
              : name === 'appearance'
                ? page.getByRole('spinbutton', { name: 'Terminal font size', exact: true })
                : name === 'browser'
                  ? page.getByRole('button', { name: 'Browser options', exact: true })
                  : name === 'thread-info'
                    ? page.getByRole('button', { name: 'Customize thread info', exact: true })
                    : null
        if (control) {
          await control.scrollIntoViewIfNeeded()
          await control.click()
          await page.waitForFunction(
            () => !document.body.innerText.includes('Loading provider models…'),
          )
          await page.screenshot({
            path: resolve(output, `${name}-controls-${mode}.png`),
            animations: 'disabled',
          })
          if (name === 'conversation') {
            await page.getByRole('button', { name: 'About Daybreak', exact: true }).click()
            await page.getByRole('region', { name: 'About Daybreak', exact: true }).waitFor()
            await page.screenshot({
              path: resolve(output, `conversation-daybreak-help-${mode}.png`),
              animations: 'disabled',
            })
            await page.getByRole('button', { name: 'About Daybreak', exact: true }).click()
          }
          await page.keyboard.press('Escape')
        }
      }
      console.log(
        `${name}-${mode}: ${(await page.locator('body').innerText()).slice(0, 100).replaceAll('\n', ' | ')}`,
      )
    }
  if (process.argv.includes('--dialogs') || process.argv.includes('--dialogs-only'))
    await captureFollowUpDialogs(page, origin, output)
  await writeFile(
    resolve(output, 'manifest.json'),
    JSON.stringify({ screens: manifest, errors }, null, 2),
  )
  if (errors.length) throw Error(errors.join('\n'))
  console.log(`Screenshots: ${output}`)
} finally {
  for (const peer of sockets.clients) peer.terminate()
  sockets.close()
  await browser?.close()
  await server.close()
}
