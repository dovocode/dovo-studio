import { chromium } from './browser/harness.mjs'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
const host = JSON.parse(await readFile('packages/studio-ui/mcp-apps/host.json', 'utf8'))
const guest = (
  await build({
    stdin: {
      contents: `import { App } from '@modelcontextprotocol/ext-apps';import { z } from 'zod';
const app = new App({ name:'Fixture', version:'1' }, {tools:{listChanged:true}});
app.registerTool('selection', {description:'Read selection',inputSchema:z.object({}),annotations:{readOnlyHint:true}}, async()=>({content:[{type:'text',text:document.querySelector('#result').textContent}]}));
app.ontoolresult = (result) => { document.querySelector('#result').textContent = result.structuredContent.count; };
document.querySelector('button').onclick = async () => { const result = await app.callServerTool({ name: 'refresh', arguments: {} }); document.querySelector('#result').textContent = result.structuredContent.count; };
await app.connect();`,
      resolveDir: 'packages/studio-ui',
      sourcefile: 'guest.ts',
    },
    bundle: true,
    format: 'esm',
    write: false,
    target: 'es2022',
  })
).outputFiles[0].text
const app = {
  id: 'app',
  taskId: 'task',
  title: 'Fixture',
  server: 's',
  tool: 'chart',
  input: {},
  result: { content: [{ type: 'text', text: 'ready' }], structuredContent: { count: 1 } },
  resource: {
    uri: 'ui://fixture',
    mimeType: 'text/html;profile=mcp-app',
    text: `<button>Refresh</button><div id="result"></div><script type="module">${guest.replace(/<\/script/g, '<\\/script')}</script>`,
  },
  format: 'apps',
  connected: true,
}
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 650 } })
  page.on('pageerror', (e) => console.log('error:', e.stack))
  await page.setContent(
    host.replace(
      '<script>',
      '<script>window.reports=[];window.ReactNativeWebView={postMessage:(text)=>window.reports.push(JSON.parse(text))};',
    ),
  )
  await page.evaluate((app) => window.dovoMcpLoad(app, 'test-nonce', 'dark'), app)
  const result = page.frameLocator('iframe').frameLocator('iframe').locator('#result')
  await result.waitFor({ timeout: 3000 })
  await page.waitForFunction(
    () => window.reports.some((r) => r.type === 'error') || document.querySelector('iframe'),
  )
  await page
    .frames()
    .at(-1)
    .waitForFunction(() => document.querySelector('#result')?.textContent === '1')
  await page.frameLocator('iframe').frameLocator('iframe').locator('button').click()
  await page.waitForFunction(() => window.reports.some((r) => r.type === 'request'))
  const request = await page.evaluate(() => window.reports.find((r) => r.type === 'request'))
  if (request.method !== 'tools/call' || request.nonce !== 'test-nonce')
    throw new Error('Missing scoped action')
  await page.evaluate(
    (request) =>
      window.dovoMcpReply({
        nonce: 'test-nonce',
        requestId: request.requestId,
        result: { content: [], structuredContent: { count: 2 } },
      }),
    request,
  )
  await page
    .frames()
    .at(-1)
    .waitForFunction(() => document.querySelector('#result')?.textContent === '2')
  await page.waitForFunction(() =>
    window.reports.some(
      (r) => r.type === 'app-tools' && r.tools.some((t) => t.name === 'selection'),
    ),
  )
  await page.evaluate(() =>
    window.dovoMcpAppTool({
      type: 'app-tool-call',
      nonce: 'wrong',
      requestId: 'wrong',
      name: 'selection',
      arguments: {},
    }),
  )
  await page.evaluate(() =>
    window.dovoMcpAppTool({
      type: 'app-tool-call',
      nonce: 'test-nonce',
      requestId: 'selection-1',
      name: 'selection',
      arguments: {},
    }),
  )
  await page.waitForFunction(() =>
    window.reports.some((r) => r.type === 'app-tool-result' && r.requestId === 'selection-1'),
  )
  const selection = await page.evaluate(() =>
    window.reports.find((r) => r.type === 'app-tool-result' && r.requestId === 'selection-1'),
  )
  if (selection.result?.content?.[0]?.text !== '2')
    throw new Error('App tool did not read live selection')
  if (await page.evaluate(() => window.reports.some((r) => r.requestId === 'wrong')))
    throw new Error('App tool accepted wrong view nonce')
  const guestFrame = page.frames().at(-1)
  const inaccessible = await guestFrame.evaluate(() => {
    try {
      return typeof top.ReactNativeWebView === 'undefined'
    } catch {
      return true
    }
  })
  if (!inaccessible) throw new Error('Guest reached native bridge')
  const blocked = await guestFrame.evaluate(async () => {
    try {
      await fetch('https://example.com')
      return false
    } catch {
      return true
    }
  })
  if (!blocked) throw new Error('Undeclared network access was allowed')
  console.log('MCP Apps handshake, result, interactive action, native isolation and CSP passed')
  for (const format of ['html', 'remote-dom', 'url']) {
    const legacyPage = await browser.newPage()
    await legacyPage.route('http://fixture.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>External legacy app</h1>' }),
    )
    legacyPage.on('pageerror', (error) => console.log('legacy error', error.message))
    legacyPage.on('console', (message) => {
      if (message.type() === 'error') console.log('legacy console', message.text())
    })
    await legacyPage.setContent(
      host.replace(
        '<script>',
        '<script>window.reports=[];window.ReactNativeWebView={postMessage:(text)=>window.reports.push(JSON.parse(text))};',
      ),
    )
    const resource =
      format === 'html'
        ? {
            uri: 'ui://legacy',
            mimeType: 'text/html',
            text: "<button onclick=\"parent.postMessage({type:'tool',payload:{toolName:'refresh',params:{}}},'*')\">Legacy refresh</button>",
          }
        : format === 'url'
          ? { uri: 'ui://legacy', mimeType: 'text/uri-list', text: 'http://fixture.test/app' }
          : {
              uri: 'ui://legacy',
              mimeType: 'application/vnd.mcp-ui.remote-dom',
              text: 'const text=document.createElement("ui-text");text.setAttribute("content","Remote DOM works");root.append(text);',
            }
    await legacyPage.evaluate(
      (resource) =>
        window.dovoMcpLoad(
          {
            id: 'legacy',
            taskId: 'task',
            title: 'Legacy',
            tool: 'legacy',
            server: 's',
            input: {},
            result: { content: [] },
            resource,
            format: 'legacy',
            connected: true,
          },
          'legacy-nonce',
          'dark',
        ),
      resource,
    )
    if (format === 'html') {
      await legacyPage.frameLocator('iframe').locator('button').click()
      await legacyPage.waitForFunction(() => window.reports.some((r) => r.type === 'request'))
      const req = await legacyPage.evaluate(() => window.reports.find((r) => r.type === 'request'))
      if (req.method !== 'tools/call') throw new Error('Legacy action not bridged')
    } else if (format === 'url') {
      await legacyPage.waitForFunction(() =>
        window.reports.some((r) => r.method === 'ui/open-embedded'),
      )
      const req = await legacyPage.evaluate(() =>
        window.reports.find((r) => r.method === 'ui/open-embedded'),
      )
      await legacyPage.evaluate(
        (req) =>
          window.dovoMcpReply({ nonce: 'legacy-nonce', requestId: req.requestId, result: {} }),
        req,
      )
      await legacyPage.frameLocator('iframe').locator('h1').waitFor({ timeout: 3000 })
    } else await legacyPage.getByText('Remote DOM works').waitFor({ timeout: 3000 })
    await legacyPage.close()
    console.log('Legacy', format, 'passed')
  }
} finally {
  await browser.close()
}
