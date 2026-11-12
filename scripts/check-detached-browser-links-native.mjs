import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'apps/desktop/package.json'))
const directory = await mkdtemp(join(tmpdir(), 'dovo-detached-links-'))
const submissions = []
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'text/html')
  if (request.url === '/submitted') {
    let body = ''
    for await (const chunk of request) body += chunk
    submissions.push({ method: request.method, body })
    response.end('<!doctype html><title>Submitted</title><p>Form received</p>')
  } else if (request.url === '/source') {
    response.setHeader('Set-Cookie', 'preview-session=kept; SameSite=Lax')
    response.end(`<!doctype html><title>Detached preview</title>
      <input id="draft" value="Unsaved draft">
      <a target="_blank" href="/child">Open child</a>
      <button id="delayed" onclick="const child=window.open('about:blank','delayed');setTimeout(()=>child.location.href='/delayed',50)">Open delayed</button>
      <button id="auth" onclick="window.open('/auth','auth','width=500,height=400')">Open auth</button>
      <form method="post" target="_blank" action="/submitted"><input name="draft" value="Keep this value"><button>Submit form</button></form>`)
  } else
    response.end(
      '<!doctype html><title>Child preview</title><a target="_blank" href="/nested">Open nested</a><button onclick="opener.document.querySelector(\'#draft\').value=\'Auth complete\';window.close()">Complete auth</button>',
    )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let app
try {
  const entry = join(directory, 'main.cjs')
  await build({
    stdin: {
      resolveDir: join(root, 'apps/desktop'),
      loader: 'ts',
      contents: `import {app,BrowserWindow,dialog} from 'electron';
import {openBrowserLink,setLinkReceiver} from './electron/links';
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async()=>{
  globalThis.linkPrompts=[];globalThis.dialogs=0;
  dialog.showMessageBox=async()=>{globalThis.dialogs++;return {response:2,checkboxChecked:false}};
  const owner=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await owner.loadURL('data:text/html,<title>Studio owner</title>');
  const send=owner.webContents.send.bind(owner.webContents);
  owner.webContents.send=(channel,...args)=>{if(channel==='links:open')globalThis.linkPrompts.push(args[0]);send(channel,...args)};
  setLinkReceiver(owner.webContents,true);
  globalThis.owner=owner;
  await openBrowserLink(owner,${JSON.stringify(origin + '/source')});
});`,
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  })
  app = await electron.launch({
    executablePath: require('electron'),
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), entry],
  })
  const source = await app
    .waitForEvent('window', {
      predicate: (page) => page.url() === origin + '/source',
      timeout: 10000,
    })
    .catch(async () => {
      const source = app.windows().find((page) => page.url() === origin + '/source')
      assert(source, 'Detached preview opened')
      return source
    })
  const open = async (page, label, path) => {
    const created = app.waitForEvent('window', { timeout: 5000 })
    await page.getByText(label, { exact: true }).click()
    const child = await created
    child.setDefaultTimeout(10000)
    await child.waitForURL(origin + path)
    await child.waitForLoadState('domcontentloaded')
    return child
  }
  const child = await open(source, 'Open child', '/child')
  assert.match(await child.evaluate(() => document.cookie), /preview-session=kept/)
  assert.equal(await source.locator('#draft').inputValue(), 'Unsaved draft')
  const nested = await open(child, 'Open nested', '/nested')
  assert.match(await nested.evaluate(() => document.cookie), /preview-session=kept/)
  await open(source, 'Open delayed', '/delayed')
  const auth = await open(source, 'Open auth', '/auth')
  const complete = auth.getByText('Complete auth', { exact: true })
  await complete.click({ trial: true })
  const bounds = await complete.boundingBox()
  assert.ok(bounds, 'The auth control must be visible')
  const authWindow = await app.browserWindow(auth)
  try {
    // This click closes its renderer. Send native input from the surviving main
    // process, then check closure and the opener callback instead of a click reply.
    await Promise.all([
      auth.waitForEvent('close', { timeout: 10000 }),
      authWindow.evaluate(
        (popup, point) => {
          popup.webContents.sendInputEvent({
            type: 'mouseDown',
            button: 'left',
            clickCount: 1,
            ...point,
          })
          popup.webContents.sendInputEvent({
            type: 'mouseUp',
            button: 'left',
            clickCount: 1,
            ...point,
          })
        },
        { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) },
      ),
    ])
  } finally {
    await authWindow.dispose()
  }
  await source.waitForFunction(() => document.querySelector('#draft').value === 'Auth complete')
  await open(source, 'Submit form', '/submitted')
  assert.deepEqual(submissions, [{ method: 'POST', body: 'draft=Keep+this+value' }])
  assert.equal(
    await child.evaluate(() => window.open('file:///tmp/dovo-disallowed') === null),
    true,
  )
  assert.deepEqual(await app.evaluate(() => globalThis.linkPrompts), [])
  assert.equal(await app.evaluate(() => globalThis.dialogs), 0)
  assert.equal(await child.evaluate(() => typeof process), 'undefined')
  assert.deepEqual(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((window) => window.webContents.getURL().endsWith('/child'))
        .map((window) => {
          const preferences = window.webContents.getLastWebPreferences()
          return {
            sandbox: preferences.sandbox,
            contextIsolation: preferences.contextIsolation,
            nodeIntegration: preferences.nodeIntegration,
          }
        }),
    ),
    [{ sandbox: true, contextIsolation: true, nodeIntegration: false }],
  )
  const childrenClosed = Promise.all(
    [child, nested].map((page) => page.waitForEvent('close', { timeout: 10000 })),
  )
  await source.close()
  await childrenClosed
  assert(nested.isClosed(), 'Child previews close with their opener')
  console.log(
    'Native detached preview links passed: _blank, nested and delayed windows, session cookies, opener callback, POST form, unsafe URL rejection and opener cleanup; no Studio chooser or native prompt.',
  )
} catch (error) {
  if (app)
    console.error(
      'Link routing:',
      await app.evaluate(() => ({ prompts: globalThis.linkPrompts, dialogs: globalThis.dialogs })),
    )
  throw error
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
