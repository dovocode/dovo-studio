import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium, bundleBrowser } from './browser/harness.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { decode, taskSchema } from '../packages/protocol/dist/index.js'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Effect}from'effect';import{StudioToolsBridge}from'${root}packages/studio-shell/src/studio-tools-bridge';import{StudioPairedComputersBridge}from'${root}packages/studio-shell/src/studio-paired-computers-bridge';import{StudioToolsPreferences}from'${root}packages/extension-runtime/src/runtime-preferences';window.studio={connected:true,connection:window.connection,snapshot:{studioTools:{ui:true,threads:true}},runtimeRegistry:{profiles:[window.paired]},runtimes:[],requestEffect:(path,input,schema)=>Effect.tryPromise({try:async()=>{const response=await fetch(window.connection.address+path,{method:'POST',headers:{Authorization:'Bearer '+window.connection.token,'Content-Type':'application/json'},body:JSON.stringify(input)});if(!response.ok)throw new Error(await response.text());return await response.json()},catch:error=>error instanceof Error?error:new Error(String(error))})};function App(){const[revision,setRevision]=useState(0);window.refreshStudio=()=>setRevision(value=>value+1);const[text,setText]=useState(''),[saved,setSaved]=useState('');return <><StudioToolsBridge/><StudioPairedComputersBridge/><h1>Studio tools fixture</h1><StudioToolsPreferences/><label>Prompt<textarea aria-label="Prompt" value={text} onChange={event=>setText(event.target.value)}/></label><button data-save-prompt onClick={()=>setSaved(text)}>Save prompt</button><output>{saved}</output><div data-studio-human-only><button onClick={()=>window.approved=true}>Approve test gate</button></div></>}createRoot(document.getElementById('app')).render(<App/>);`,
      resolveDir: root + 'packages/studio-core',
      loader: 'tsx',
    },
    nodePaths: [root + 'apps/web/node_modules', root + 'packages/studio-core/node_modules'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {clientTaskScope} from '@dovo/client-runtime';export const useWorkspace=()=>window.studio;`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: `export {useState as useApplicationState} from 'react';`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const Input='input';export const Select=({children})=><div>{children}</div>;export const SelectContent=Select,SelectItem=Select,SelectTrigger=Select,SelectValue=Select;export const SettingsGroup=({title,description,children})=><section><h2>{title}</h2><p>{description}</p>{children}</section>;export const SettingRow=({label,description,children})=><div><span>{label}</span><p>{description}</p>{children}</div>;export const Toggle=({label,checked,disabled,onChange})=><button role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={()=>onChange(!checked)}>{label}</button>;`,
    },
  ],
)
const ui = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(
    '<!doctype html><title>Studio tools test</title><div id="app"></div><script>' +
      built.outputFiles[0].text +
      '</script>',
  )
})
ui.listen(0, '127.0.0.1')
await once(ui, 'listening')
const address = ui.address()
assert.ok(address && typeof address !== 'string')
const pageURL = `http://127.0.0.1:${address.port}`
const owner = 'studio-browser-owner-token-at-least-32-characters'
const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
const remote = await startRuntime({
  databasePath: ':memory:',
  ownerToken: 'remote-studio-browser-owner-token-at-least-32-characters',
  port: 0,
})
remote.services.preferences.save({
  enableStudioThreads: true,
  enableStudioBrowsers: true,
  enableStudioDiagnostics: true,
})
const pairedToken = randomUUID()
remote.services.devices.add('Paired Studio', pairedToken)
const paired = {
  id: 'paired-computer',
  name: 'Paired computer',
  connection: { address: `http://127.0.0.1:${remote.port}`, token: pairedToken },
}
const s = runtime.services
s.preferences.save({
  enableStudioUI: true,
  enableStudioThreads: true,
  enableStudioAutomations: true,
  enableStudioBrowsers: true,
  enableStudioDiagnostics: true,
})
const taskId = randomUUID(),
  runId = randomUUID()
s.store.update((workspace) => ({
  ...workspace,
  tasks: [
    decode(taskSchema, {
      id: taskId,
      title: 'Test parent',
      agentId: '',
      repositoryId: '',
      status: 'running',
      activeRunId: runId,
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: '',
      example: false,
    }),
  ],
}))
const token = s.runCredentials.issue(
  {
    taskId,
    runId,
    permissions: { provider: 'codex', permission: 'full-access' },
    readOnly: false,
    artifacts: false,
    pipelineWatching: false,
    pullRequestWatching: false,
    deviceHub: false,
    memoryScopes: [],
    studioTools: { threads: true, automations: true, browsers: true, ui: true, diagnostics: true },
  },
  new AbortController().signal,
)
const origin = `http://127.0.0.1:${runtime.port}`
async function call(part, command, expected = 200, runtimeId) {
  const result = await fetch(origin + '/api/studio/tools', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, parentRunId: runId, part, command, runtimeId }),
  })
  const body = await result.json()
  assert.equal(result.status, expected, JSON.stringify(body))
  return body
}
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.addInitScript(
    (value) => {
      window.connection = value.connection
      window.paired = value.paired
    },
    { connection: { address: origin, token: owner }, paired },
  )
  await page.goto(pageURL)
  await page.getByRole('heading', { name: 'Studio Tools (experimental)' }).waitFor()
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Threads"]').getAttribute('aria-checked') === 'true' &&
      !document.querySelector('[aria-label="Threads"]').disabled,
  )
  for (const name of ['Threads', 'Automations', 'Browsers', 'UI interaction', 'Diagnostics'])
    assert.equal(
      await page.getByRole('switch', { name, exact: true }).getAttribute('aria-checked'),
      'true',
    )
  await page.getByRole('switch', { name: 'Diagnostics', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Diagnostics"]').getAttribute('aria-checked') ===
        'false' && !document.querySelector('[aria-label="Diagnostics"]').disabled,
  )
  assert.equal(s.preferences.get().enableStudioDiagnostics, false)
  assert.equal(s.preferences.get().enableStudioThreads, true)
  await call('diagnostics', { action: 'health' }, 403)
  await page.getByRole('switch', { name: 'Diagnostics', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Diagnostics"]').getAttribute('aria-checked') ===
        'true' && !document.querySelector('[aria-label="Diagnostics"]').disabled,
  )
  await page.reload()
  await page.getByRole('heading', { name: 'Studio Tools (experimental)' }).waitFor()
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Diagnostics"]').getAttribute('aria-checked') ===
        'true' && !document.querySelector('[aria-label="Diagnostics"]').disabled,
  )
  const { sessions } = await call('ui', { action: 'list' })
  const sessionId = sessions.at(-1).id
  const snapshot = await call('ui', { action: 'snapshot', sessionId })
  assert.ok(snapshot.text.includes('Studio tools fixture'))
  const prompt = snapshot.controls.find((control) => control.label === 'Prompt')
  assert.ok(prompt)
  await call('ui', {
    action: 'fill',
    sessionId,
    selector: prompt.selector,
    text: 'Reproduce thread behavior',
  })
  await call('ui', { action: 'click', sessionId, selector: '[data-save-prompt]' })
  assert.equal(await page.locator('output').textContent(), 'Reproduce thread behavior')
  const protectedResult = await call('ui', {
    action: 'click',
    sessionId,
    selector: '[data-studio-human-only] button',
  })
  assert.match(protectedResult.error, /human review/)
  assert.equal(await page.evaluate(() => window.approved), undefined)
  const opened = await call('browsers', { action: 'open', url: pageURL + '/browser' })
  assert.ok(opened.id)
  assert.ok(opened.image)
  const listed = await call('browsers', { action: 'list' })
  assert.ok(
    listed.sessions.some((session) => session.id === opened.id && session.url.startsWith(pageURL)),
  )
  await call('browsers', {
    action: 'evaluate',
    id: opened.id,
    script: 'console.error("Studio browser debug");void fetch("http://127.0.0.1:1/missing");"ok"',
  })
  const logs = await call('browsers', { action: 'logs', id: opened.id })
  assert.ok(logs.entries.some((entry) => entry.message.includes('Studio browser debug')))
  const second = await call('browsers', { action: 'open' })
  assert.notEqual(second.id, opened.id)
  await call('browsers', { action: 'close', id: opened.id })
  await call('browsers', { action: 'snapshot', id: opened.id }, 404)
  await call('browsers', { action: 'close', id: second.id })
  const discovery = await call('discover', {})
  assert.ok(discovery.computers.some((computer) => computer.id === paired.id))
  assert.ok(!JSON.stringify(discovery).includes(pairedToken))
  await call('diagnostics', { action: 'health' }, 200, paired.id)
  await call('ui', { action: 'list' }, 403, paired.id)
  const remoteBrowser = await call(
    'browsers',
    { action: 'open', url: pageURL + '/remote' },
    200,
    paired.id,
  )
  assert.ok(remoteBrowser.image)
  assert.ok(
    (await remote.services.browsers.studioList()).some(
      (session) => session.id === remoteBrowser.id,
    ),
  )
  assert.ok(!(await s.browsers.studioList()).some((session) => session.id === remoteBrowser.id))
  await call('browsers', { action: 'close', id: remoteBrowser.id }, 200, paired.id)
  await page.evaluate(() => {
    window.studio.runtimeRegistry = { profiles: [] }
    window.refreshStudio()
  })
  await page.waitForTimeout(100)
  await call('diagnostics', { action: 'health' }, 404, paired.id)
  // Do alone also keeps the local pairing bridge alive; Studio Tools can stay disabled.
  const doRegistration = page.waitForResponse(
    (response) => response.url() === origin + '/api/studio/peers' && response.ok(),
  )
  await page.evaluate((profile) => {
    window.studio.snapshot = { studioTools: { ui: true }, doEnabled: true }
    window.studio.runtimeRegistry = { profiles: [profile] }
    window.refreshStudio()
  }, paired)
  await doRegistration
  assert.ok((await call('discover', {})).computers.some((computer) => computer.id === paired.id))
  await page.getByRole('switch', { name: 'UI interaction', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="UI interaction"]').getAttribute('aria-checked') ===
      'false',
  )
  await call('ui', { action: 'snapshot', sessionId }, 403)
  console.log(
    'Studio Tools: independent persisted toggles, live UI inspection/interaction, review protection, browser sessions/screenshots/logs passed.',
  )
} finally {
  await browser.close()
  await runtime.close()
  await remote.close()
  await new Promise((resolve) => ui.close(resolve))
}
