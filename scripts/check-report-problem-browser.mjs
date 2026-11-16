import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'

// The real dialog in Chromium against a real runtime: form, preview, redaction and start.
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const ui = `${root}/packages/studio-ui/src`
const owner = 'report-problem-owner-token-at-least-32-characters'
const deviceToken = 'Q9vJ3kTq_x7LmZp2RfA8sW-cY1nBdE4hUoK6gVtXy0M'
const directory = await mkdtemp(join(tmpdir(), 'dovo-report-problem-browser-'))
const runtime = await startRuntime({
  databasePath: join(directory, 'runtime.sqlite'),
  port: 0,
  ownerToken: owner,
})
// Keep the started agent turn local and immediate.
runtime.services.agents.get = async () => ({
  probe: async () => ({ ok: true }),
  run: async (input) => {
    input.onSession('browser-session')
    input.onText('Triage started')
  },
})
await writeFile(
  join(directory, 'server.log'),
  `GET /api/snapshot Authorization: Bearer ${deviceToken}\nLAST LOG LINE\n`,
)
const call = async (path, input, method = 'POST') => {
  const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}
const snapshot = await call('/api/snapshot', undefined, 'GET')
assert.equal(snapshot.problemReportsSupported, true)

const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: `${root}/packages/studio-shell/src/report-problem`,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {ReportProblemDialog} from './report-problem-dialog';
window.closeCount=0;window.opened=[];
createRoot(document.getElementById('app')).render(<ReportProblemDialog onClose={()=>window.closeCount++}/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    conditions: ['development'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `
const profile={id:'computer',name:'Workstation',connection:{address:'http://10.0.0.2:4321',token:'t'.repeat(24)}};
const workspace={
  runtimes:[{profile,snapshot:window.snapshot,connected:true,lastSeen:null,error:null,pulls:null,pullError:null},
    {profile:{...profile,id:'old',name:'Old laptop'},snapshot:{...window.snapshot,problemReportsSupported:undefined},connected:true,lastSeen:null,error:null,pulls:null,pullError:null}],
  activeRuntimeId:'computer',
  readRuntime:async(_profile,path,input,schema)=>{const value=await window.runtimeCall(path,input);return value},
  refreshRuntime:async()=>{},
};
export const useWorkspace=()=>workspace;
export const useStudioHost=()=>({appInfo:{version:'0.0.7',channel:'nightly',viewer:{platform:'darwin',architecture:'arm64',processArchitecture:'arm64'}},openThread:target=>window.opened.push(target)});
export const WorkspaceScope=({children})=>children;`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `
export * from '${ui}/components/ui/dialog';
export {Button} from '${ui}/components/ui/button';
export {Checkbox} from '${ui}/components/ui/checkbox';
export {Textarea} from '${ui}/components/ui/textarea';
export {FormField} from '${ui}/components/form-field';
export const permissionPolicyUIIssue=()=>undefined;`,
    },
    {
      path: '../task-launcher-controls',
      importer: `${root}/packages/studio-shell/src/report-problem/`,
      contents: `export const TaskLauncherControls=({selection})=><span data-agent>{selection.provider}</span>;`,
    },
  ],
)

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  const errors = []
  const calls = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.exposeFunction('runtimeCall', async (path, input) => {
    calls.push({ path, input })
    return call(path, input)
  })
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({
    content:
      '[role=dialog]{position:fixed;inset:20px;background:white;padding:20px;overflow:auto}pre{max-height:200px;overflow:auto}',
  })
  await page.evaluate((value) => {
    window.snapshot = value
  }, snapshot)
  await page.addScriptTag({ content: built.outputFiles[0].text })

  const dialog = page.getByRole('dialog', { name: 'Report a problem' })
  await dialog.waitFor()
  const previewButton = page.getByRole('button', { name: 'Preview', exact: true })
  // The description is required; older runtimes cannot be chosen.
  assert.equal(await previewButton.isDisabled(), true)
  assert.equal(
    await page.getByRole('option', { name: /Old laptop \(update required\)/ }).isDisabled(),
    true,
  )
  assert.equal(await page.locator('[data-agent]').textContent(), 'codex')
  const checkboxes = page.getByRole('checkbox')
  assert.equal(await checkboxes.count(), 3)
  for (const box of await checkboxes.all())
    assert.equal(await box.getAttribute('aria-checked'), 'true')

  await page
    .getByLabel('What happened? (required)')
    .fill(`Threads stop syncing after I paste my token ${deviceToken}`)
  await page.getByLabel('What did you expect? (optional)').fill('Threads keep syncing.')
  await page.getByRole('checkbox').nth(2).click()
  assert.equal(await page.getByRole('checkbox').nth(2).getAttribute('aria-checked'), 'false')
  await previewButton.click()

  await page.getByRole('region', { name: 'First message' }).waitFor()
  const message = await page.getByRole('region', { name: 'First message' }).textContent()
  const file = await page.getByRole('region', { name: 'Attached file' }).textContent()
  assert.match(message, /Threads stop syncing after I paste my token \[redacted\]/)
  assert.match(message, /Do not create the issue/)
  assert.match(file, /dovo-diagnostics\.md/)
  assert.match(file, /Source commit: [0-9a-f]{40}/)
  assert.match(file, /Reporting client: desktop, version 0\.0\.7, nightly channel, on darwin arm64/)
  assert.match(file, /LAST LOG LINE/)
  assert.doesNotMatch(file, /Recent client errors/)
  assert.equal((message + file).includes(deviceToken), false)
  assert.match(await dialog.textContent(), /The runtime hid \d+ values/)
  const previewCall = calls.find((entry) => entry.path === '/api/problem-reports/preview')
  assert.deepEqual(previewCall.input.include, {
    versions: true,
    diagnostics: true,
    clientErrors: false,
  })
  assert.deepEqual(previewCall.input.clientErrors, [])

  // Edit keeps the form, and a new preview reflects the change.
  await page.getByRole('button', { name: 'Edit report', exact: true }).click()
  assert.equal(
    await page.getByLabel('What did you expect? (optional)').inputValue(),
    'Threads keep syncing.',
  )
  await previewButton.click()
  await page.getByRole('button', { name: 'Start triage thread', exact: true }).click()
  await page.waitForFunction(() => window.closeCount === 1)
  const opened = await page.evaluate(() => window.opened)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].runtimeId, 'computer')
  assert.match(opened[0].title, /^Problem: Threads stop syncing/)
  const task = runtime.services.store.task(opened[0].threadId)
  assert.equal(task.repositoryId, 'dovo:scratch')
  const first = [...task.messages.filter((item) => item.role === 'user'), ...(task.queue ?? [])][0]
  assert.match(first.text, /Triage playbook:/)
  assert.deepEqual(
    first.attachments.map((item) => item.name),
    ['dovo-diagnostics.md'],
  )
  assert.deepEqual(errors, [])
  console.log('Report a problem browser check passed.')
} finally {
  await browser.close()
  await runtime.close()
  await rm(directory, { recursive: true, force: true })
}
