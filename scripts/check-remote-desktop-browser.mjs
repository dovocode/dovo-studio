import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
import { fileURLToPath } from 'node:url'
import { readFile, readdir, mkdir } from 'node:fs/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {decode,remoteDesktopResponseSchema,remoteDesktopRequestSchema} from '@dovo/protocol';
import {RemoteDesktopViewer} from '../extension-runtime/src/remote-desktop-view';
window.calls=[];window.enabled=false;window.connected=true;window.session=null;window.failStop=false;window.failInput=false;window.hold=false;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#102030"/><text x="32" y="50" fill="white" font-size="24">DEMO · Remote desktop</text><rect x="100" y="100" width="800" height="400" rx="12" fill="#edf2f7"/><text x="140" y="160" font-size="24">Primary display — demo data</text></svg>';
window.frame=()=>({id:crypto.randomUUID(),width:1000,height:600,image:'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)))});
window.request=async(path,raw)=>{
 const input=decode(remoteDesktopRequestSchema,raw);window.calls.push(input);
 if(input.action==='stop'){if(window.failStop)throw Error('Computer unreachable');window.session=null;return {session:null}}
 if(!window.enabled)throw Error('Remote desktop is disabled');
 if(input.action==='start')window.session={id:input.id,viewer:'Desktop browser',control:false};
 if(input.action==='input'){if(window.failInput)throw Error('Native input refused; inspect before retrying');if(window.hold)await new Promise(resolve=>window.release=resolve)}
 if(input.action==='control')window.session.control=input.enabled;
 return decode(remoteDesktopResponseSchema,{session:window.session,...(['start','frame','input'].includes(input.action)?{frame:window.frame()}:{})})
};
function App(){const[,render]=useState(0);window.update=changes=>{Object.assign(window,changes);render(x=>x+1)};window.store={request:window.request,connected:window.connected,snapshot:{remoteDesktopEnabled:window.enabled}};return <RemoteDesktopViewer/>}
createRoot(document.getElementById('app')).render(<App/>);
`,
    loader: 'tsx',
    resolveDir: root + 'packages/studio-ui',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  conditions: ['development'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'runtime',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          ['@dovo/studio-core', './runtime-preferences', './host-page'].includes(path)
            ? { path, namespace: 'fixture' }
            : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === '@dovo/studio-core'
              ? `export * from '${root}packages/studio-core/src/index.ts';export const useWorkspace=()=>window.store;`
              : path === './host-page'
                ? 'export const HostPage=({children})=>children;'
                : 'export const RemoteDesktopPreferences=()=>null;',
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
        }))
      },
    },
  ],
})
const assets = root + 'apps/desktop/dist/assets'
const css = await readFile(
  assets +
    '/' +
    (await readdir(assets)).find((name) => name.startsWith('index-') && name.endsWith('.css')),
  'utf8',
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://dovo.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<meta charset="utf-8"><style>${css}</style><div style="padding:24px;max-width:1000px;margin:auto" id="app"></div>`,
    }),
  )
  await page.goto('https://dovo.test')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByText(/Enable experimental remote desktop above/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Connect to desktop' }).count(), 0)
  await page.evaluate(() => window.update({ enabled: true }))
  await page.getByRole('button', { name: 'Connect to desktop' }).click()
  const image = page.getByRole('img', { name: 'Remote primary display' })
  await image.waitFor()
  assert.equal(await page.getByRole('button', { name: 'Type text', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Enable control', exact: true }).click()
  await page.getByRole('button', { name: 'Switch to view only', exact: true }).waitFor()
  const idle = () =>
    page.waitForFunction(
      () =>
        window.calls.length &&
        document.querySelector('button') &&
        !Array.from(document.querySelectorAll('button')).find(
          (button) => button.textContent === 'Refresh desktop',
        )?.disabled,
    )
  await idle()
  const bounds = await image.boundingBox()
  assert.ok(bounds)
  await page.mouse.move(bounds.x + 30, bounds.y + 30)
  await idle()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.waitForFunction(() => window.calls.some((call) => call.input?.type === 'click'))
  const click = await page.evaluate(
    () => window.calls.find((call) => call.input?.type === 'click').input,
  )
  assert.ok(Math.abs(click.x - 500) < 2 && Math.abs(click.y - 300) < 2)
  await idle()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    button: 'right',
  })
  await page.waitForFunction(() =>
    window.calls.some((call) => call.input?.type === 'click' && call.input.button === 'right'),
  )
  await idle()
  await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.waitForFunction(() =>
    window.calls.some((call) => call.input?.type === 'click' && call.input.count === 2),
  )
  await idle()
  await image.focus()
  await page.keyboard.type('hello')
  await page.waitForFunction(
    () =>
      window.calls
        .filter((call) => call.input?.type === 'text')
        .map((call) => call.input.text)
        .join('') === 'hello',
  )
  await idle()
  await page.evaluate(() => window.update({ hold: true }))
  await image.focus()
  await page.keyboard.type(' queued text')
  await page.waitForFunction(() => typeof window.release === 'function')
  await page.evaluate(() => {
    window.hold = false
    window.release()
  })
  await page.waitForFunction(
    () =>
      window.calls
        .filter((call) => call.input?.type === 'text')
        .map((call) => call.input.text)
        .join('') === 'hello queued text',
  )
  await idle()
  await page.keyboard.press('Control+a')
  await page.waitForFunction(() =>
    window.calls.some((call) => call.input?.key === 'a' && call.input.modifiers?.includes('ctrl')),
  )
  await idle()
  await page.keyboard.press('Tab')
  assert.equal(await image.evaluate((node) => document.activeElement === node), false)
  await idle()
  await page.mouse.move(bounds.x + 100, bounds.y + 100)
  await idle()
  await page.mouse.down()
  await page.mouse.move(bounds.x + 200, bounds.y + 200, { steps: 4 })
  await page.mouse.up()
  await page.waitForFunction(() => window.calls.some((call) => call.input?.type === 'drag'))
  await idle()
  await image.hover()
  await idle()
  await page.mouse.wheel(0, 120)
  await page.waitForFunction(() => window.calls.some((call) => call.input?.type === 'scroll'))
  await idle()
  await page.getByLabel('Text for remote desktop').fill('Hallo wereld')
  await page.getByRole('button', { name: 'Type text', exact: true }).click()
  await page.waitForFunction(() => window.calls.some((call) => call.input?.text === 'Hallo wereld'))
  await idle()
  await page.evaluate(() => window.update({ failInput: true }))
  await page.getByRole('button', { name: 'Scroll down', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Native input refused' }).waitFor()
  const attempted = await page.evaluate(
    () => window.calls.filter((call) => call.action === 'input').length,
  )
  await page.waitForTimeout(1000)
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.action === 'input').length),
    attempted,
  )
  await page.evaluate(() => window.update({ failInput: false }))
  await page.getByRole('button', { name: 'Refresh desktop', exact: true }).click()
  await page.getByRole('alert').waitFor({ state: 'detached' })
  await page.evaluate(() => window.update({ failStop: true }))
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Stop not confirmed' }).waitFor()
  await page.evaluate(() => window.update({ failStop: false }))
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
  await page.getByRole('button', { name: 'Connect to desktop' }).waitFor()
  await page.getByRole('button', { name: 'Connect to desktop' }).click()
  await image.waitFor()
  await mkdir(root + 'work/remote-desktop', { recursive: true })
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({
      path: root + 'work/remote-desktop/viewer-' + width + '.png',
      fullPage: true,
    })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  assert.deepEqual(errors, [])
  console.log(
    'Remote desktop: flag, view-only/control, scaled mouse/drag/wheel, queued typing/modifiers, keyboard escape via Tab, input failure without replay, unconfirmed stop/retry, responsive demo screenshots passed.',
  )
} finally {
  await browser.close()
}
