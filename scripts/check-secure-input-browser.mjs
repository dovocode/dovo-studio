import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
import { internetPublicKey, openSecureInput } from '../packages/protocol/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const secretKey = randomBytes(32)
const info = {
  id: 'secure-input:fixture',
  taskId: 'thread',
  title: 'Private sign-in',
  prompt: 'Enter the password',
  destination: {
    kind: 'command',
    command: '/trusted/sign-in',
    args: ['--password-stdin'],
    appendNewline: false,
  },
  directory: '/project',
  publicKey: internetPublicKey(secretKey),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  status: 'pending',
}
const native = `
import {useImperativeHandle,useRef} from 'react';
export const AppState={currentState:'active',addEventListener:(_event,listener)=>{window.appListeners.push(listener);return {remove:()=>window.appListeners=window.appListeners.filter(value=>value!==listener)}}};
window.background=state=>{AppState.currentState=state;for(const listener of [...window.appListeners])listener(state)};
export const View=({children})=><div>{children}</div>;
export function TextInput({ref,accessibilityLabel,secureTextEntry,editable,onChangeText,onEndEditing,onSubmitEditing}){
 const field=useRef(null);window.oldNativeChange=onChangeText;
 useImperativeHandle(ref,()=>({clear:()=>{if(field.current)field.current.value=''},isFocused:()=>document.activeElement===field.current,blur:()=>{const text=field.current.value;field.current.blur();onEndEditing({nativeEvent:{text}})}}));
 return <input ref={field} aria-label={accessibilityLabel} type={secureTextEntry?'password':'text'} disabled={!editable} onChange={event=>{if(!window.delayChange)onChangeText(event.target.value)}} onKeyDown={event=>{if(event.key==='Enter')onSubmitEditing({nativeEvent:{text:field.current.value}})}}/>
}
`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {SecureInputCard as Desktop} from './packages/extension-tasks/src/chat/thread/task-secure-inputs';
import {SecureInputCard as Mobile} from './apps/mobile/src/tasks/detail/task-secure-inputs';
import {executeStudioUI} from './packages/studio-shell/src/studio-tools-ui';
window.appListeners=[];window.studioUI=command=>executeStudioUI(document,command);
function App(){const[platform,setPlatform]=useState('desktop'),[connection,setConnection]=useState({address:'http://runtime.fixture',token:'fixture-device-token-at-least-32-characters'}),[shown,setShown]=useState(true),[input,setInput]=useState(window.input);
window.mode=setPlatform;window.swap=()=>setConnection(value=>({...value,token:'replacement-device-token-at-least-32-characters'}));window.show=setShown;window.configure=setInput;
const Component=platform==='desktop'?Desktop:Mobile;return shown?<Component key={platform} input={input} connected connection={connection}/>:null}
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export const useWorkspace=()=>({});export {clientScopeKey} from '${root}packages/client-runtime/src/effects/request-scope.ts';`,
    },
    {
      path: '../../runtime/connection/provider',
      importer: root + 'apps/mobile/src/tasks/detail',
      contents: 'export const useRuntime=()=>({});',
    },
    { path: 'react-native', contents: native },
    {
      path: '../../ui/controls/action',
      importer: root + 'apps/mobile/src/tasks/detail',
      contents: `export const Action=({label,disabled,onPress})=><button disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={onPress}>{label}</button>;`,
    },
    {
      path: '../../ui/content/text',
      importer: root + 'apps/mobile/src/tasks/detail',
      contents:
        'export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;',
    },
    {
      path: '../../ui/theme',
      importer: root + 'apps/mobile/src/tasks/detail',
      contents: 'export const useTheme=()=>({styles:{}});',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } })
  const errors = []
  const packets = []
  const values = []
  let loseReply = false
  let heldSubmit
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://secure.fixture/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.route('http://runtime.fixture/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      })
    const packet = route.request().postDataJSON()
    packets.push(packet)
    if (packet.box) values.push(openSecureInput(packet, secretKey).value)
    if (packet.box && heldSubmit) {
      heldSubmit.received.resolve()
      await heldSubmit.release.promise
    }
    if (loseReply) {
      loseReply = false
      return route.abort('failed')
    }
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        id: packet.id,
        status: route.request().url().endsWith('/cancel') ? 'cancelled' : 'completed',
      }),
    })
  })
  await page.goto('http://secure.fixture/')
  await page.evaluate((input) => {
    window.input = input
  }, info)
  await page.addScriptTag({ content: built.outputFiles[0].text })
  // Password fields do not have the textbox role in Chromium's accessibility tree.
  const privateField = page.getByLabel('Private value', { exact: true })
  await privateField.waitFor()
  assert.equal(await privateField.getAttribute('type'), 'password')
  assert.equal(await privateField.getAttribute('autocomplete'), 'off')
  const privateValue = '  fixture-private-callback?code=do-not-forward&state=private  '
  await privateField.fill(privateValue)
  assert.equal(packets.length, 0, 'Typing must not create a request')
  const snapshot = await page.evaluate(() => window.studioUI({ action: 'snapshot' }))
  assert.ok(!JSON.stringify(snapshot).includes(privateValue))
  assert.equal(
    await page.evaluate(() => {
      try {
        window.studioUI({ action: 'click', selector: '[data-studio-human-only] button' })
        return 'allowed'
      } catch (error) {
        return error.message
      }
    }),
    'Expected one control; found 2. Take a new snapshot.',
  )
  assert.match(
    await page.evaluate(() => {
      try {
        window.studioUI({
          action: 'click',
          selector: '[data-studio-human-only] button:first-child',
        })
        return 'allowed'
      } catch (error) {
        return error.message
      }
    }),
    /requires human review/,
  )
  await page.getByRole('button', { name: 'Submit and run privately', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'completed' }).waitFor()
  assert.equal(values.at(-1), privateValue)
  assert.ok(!JSON.stringify(packets).includes(privateValue))
  assert.equal(await privateField.inputValue(), '')
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0)

  // A lost response reuses exactly the same encrypted envelope.
  await page.evaluate((input) => window.configure({ ...input, id: 'secure-input:retry' }), info)
  loseReply = true
  await privateField.fill('second-fixture-private-value')
  await page.getByRole('button', { name: 'Submit and run privately', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Delivery is not confirmed' }).waitFor()
  const before = packets.at(-1)
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'completed' }).waitFor()
  assert.deepEqual(packets.at(-1), before)
  await page.evaluate(
    (input) => window.configure({ ...input, id: 'secure-input:background' }),
    info,
  )
  await privateField.fill('unsent-desktop-private-value')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  assert.equal(await privateField.inputValue(), '')
  await privateField.fill('old-device-private-value')
  await page.evaluate(() => window.swap())
  await page.waitForFunction(() => document.querySelector('input').value === '')

  // Native adapters intentionally delay onChangeText; end-editing must supply all text.
  await page.evaluate(() => {
    window.mode('mobile')
    window.delayChange = true
  })
  await privateField.waitFor()
  const fullNativeValue = 'full native callback value with a tail absent from JS change events'
  await privateField.fill(fullNativeValue)
  await page.getByRole('button', { name: 'Submit and run privately', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'completed' }).waitFor()
  assert.equal(values.at(-1), fullNativeValue)
  assert.equal(await privateField.inputValue(), '')
  await page.evaluate(
    (input) => window.configure({ ...input, id: 'secure-input:mobile-background' }),
    info,
  )
  await privateField.fill('background-private-value')
  await page.evaluate(() => {
    window.staleNativeChange = window.oldNativeChange
    window.background('background')
  })
  await page.waitForFunction(() => document.querySelector('input').value === '')
  await page.evaluate(() => {
    window.staleNativeChange('late-private-value')
    window.background('active')
  })
  const beforeEmpty = packets.length
  await page.getByRole('button', { name: 'Submit and run privately', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Enter a private value' }).waitFor()
  assert.equal(packets.length, beforeEmpty, 'Stale native text must not refill cleared input')
  await privateField.fill('cancel-private-value')
  await page.getByRole('button', { name: 'Cancel secure input', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'cancelled' }).waitFor()
  assert.deepEqual(packets.at(-1), { taskId: info.taskId, id: 'secure-input:mobile-background' })
  assert.equal(await privateField.inputValue(), '')
  // Cancel must remain available during delivery. A late submit response must not undo it.
  for (const platform of ['desktop', 'mobile']) {
    await page.evaluate(
      ({ input, platform }) => {
        window.mode(platform)
        window.configure({ ...input, id: `secure-input:cancel-running-${platform}` })
      },
      { input: info, platform },
    )
    await privateField.waitFor()
    heldSubmit = { received: Promise.withResolvers(), release: Promise.withResolvers() }
    await privateField.fill('synthetic-running-private-value')
    await page.getByRole('button', { name: 'Submit and run privately', exact: true }).click()
    await heldSubmit.received.promise
    await page.getByRole('button', { name: 'Cancel secure input', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'cancelled' }).waitFor()
    const response = page.waitForResponse((reply) => reply.url().endsWith('/submit'))
    heldSubmit.release.resolve()
    await (await response).finished()
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    assert.equal(await page.getByRole('status').textContent(), 'Secure input cancelled.')
    assert.equal(
      await page
        .getByRole('button', { name: 'Submit and run privately', exact: true })
        .isDisabled(),
      true,
    )
    assert.equal(await privateField.inputValue(), '')
    heldSubmit = undefined
    await page.evaluate((input) => window.configure(input), {
      ...info,
      id: `secure-input:hide-${platform}`,
    })
    await privateField.fill('synthetic-hidden-private-value')
    await page.evaluate(() => window.show(false))
    await privateField.waitFor({ state: 'detached' })
    await page.evaluate(() => window.show(true))
    await privateField.waitFor()
    assert.equal(await privateField.inputValue(), '', 'Hidden forms must discard private text')
  }
  await page.evaluate(() => window.show(false))
  assert.deepEqual(errors, [])
  console.log(
    'Secure input: desktop and native-adapted mobile masking, encrypted-only transport, exact native text, human-only Studio controls, identical retry, memory-only drafts, scope/background clearing, stale-event rejection and private cancellation passed.',
  )
} finally {
  secretKey.fill(0)
  await browser.close()
}
