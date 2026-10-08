import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { openDatabase } from '../packages/runtime/dist/storage/database.js'
import { WorkspaceStore } from '../packages/runtime/dist/storage/workspace.js'
import { defaultTaskHarness, runtimeProfile } from '../packages/protocol/dist/index.js'

// Capture the production workbench against an isolated, real runtime. No UI controls are mocked,
// and no personal runtime, project, credentials or conversations are read.
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dovo-site-capture-'))
const checkout = join(directory, 'dovo-studio')
await mkdir(join(checkout, 'apps/mobile/src/tasks/creation'), { recursive: true })
const sourcePath = 'apps/mobile/src/tasks/creation/folder-picker.tsx'
await writeFile(
  join(checkout, sourcePath),
  execFileSync('git', ['show', `058acb7:${sourcePath}`], { cwd: root }),
)
execFileSync('git', ['init', '-q', '-b', 'main', checkout])
execFileSync('git', ['-C', checkout, 'add', '.'])
execFileSync('git', [
  '-C',
  checkout,
  '-c',
  'user.name=Dovo Studio',
  '-c',
  'user.email=demo@example.invalid',
  'commit',
  '-qm',
  'Initial project picker',
])
await writeFile(join(checkout, sourcePath), await readFile(join(root, sourcePath)))
const createdAt = new Date().toISOString()
const repository = {
  id: 'studio',
  name: 'dovo-studio',
  path: checkout,
  branch: 'main',
  gitIdentity: 'github.com/dovocode/dovo-studio',
}
const harness = {
  ...defaultTaskHarness('codex'),
  model: 'gpt-6.1-sol',
  reasoning: 'high',
  permission: 'workspace-write',
}
const task = {
  id: 'project-picker',
  title: 'Make adding projects feel natural',
  repositoryId: 'studio',
  agentId: '',
  execution: 'main',
  status: 'review',
  createdAt,
  draft: '',
  example: false,
  harness,
  messages: [
    {
      id: 'prompt',
      role: 'user',
      text: 'Move Add project to a plus beside Close in the mobile project picker. Choose a runtime first, then continue with the existing add-project flow.',
      createdAt,
    },
    {
      id: 'reply',
      role: 'assistant',
      text: 'The project picker now starts the add flow from the toolbar.\n\n### What changed\n\n- A **plus beside Close** opens runtime selection.\n- Pick a connected runtime, then add a folder or GitHub repository.\n- Offline runtimes stay visible and are disabled.\n\n### Verification\n\nMobile typechecking and the picker interaction checks pass, including cancellation, runtime selection and offline handling.\n\nThe change is ready for review.',
      createdAt,
    },
  ],
  files: [
    {
      path: sourcePath,
      status: 'modified',
      additions: 45,
      deletions: 16,
      viewed: false,
      before: execFileSync('git', ['show', `058acb7:${sourcePath}`], { cwd: root }).toString(
        'utf8',
      ),
      after: await readFile(join(root, sourcePath), 'utf8'),
    },
  ],
}
const node = (id, kind, label, x, extra = {}) => ({
  id,
  type: 'automation',
  position: { x, y: 170 },
  data: {
    kind,
    label,
    trigger: 'manual',
    schedule: '',
    timezone: '',
    objective: '',
    agentId: '',
    repositoryId: '',
    ...extra,
  },
})
const db = openDatabase(join(directory, 'runtime.sqlite'))
try {
  const store = new WorkspaceStore(db)
  store.update((workspace) => ({
    ...workspace,
    repositories: [repository],
    agents: [
      {
        id: 'builder',
        name: 'Builder',
        provider: 'codex',
        model: '',
        instructions: 'Review changes and report concrete issues.',
        permission: 'ask',
        endpoint: '',
      },
    ],
    tasks: [
      task,
      {
        ...task,
        id: 'runtime',
        title: 'Keep the runtime running',
        status: 'done',
        messages: [],
        files: [],
      },
      {
        ...task,
        id: 'website',
        title: 'Give Dovo Studio a home',
        status: 'draft',
        messages: [],
        files: [],
        draft: 'Match the website to the Dovo Studio brand.',
      },
    ],
    automations: [
      {
        id: 'morning-review',
        name: 'Morning repository review',
        nodes: [
          node('trigger', 'trigger', 'Every weekday', 60, {
            trigger: 'schedule',
            schedule: '0 9 * * 1-5',
            timezone: 'Europe/Amsterdam',
          }),
          node('task', 'task', 'Review recent changes', 400, {
            objective: 'Review recent changes and report concrete issues.',
            repositoryId: 'studio',
            agentId: 'builder',
          }),
          node('review', 'review', 'Human review', 740),
        ],
        edges: [
          { id: 'trigger-task', source: 'trigger', target: 'task' },
          { id: 'task-review', source: 'task', target: 'review' },
        ],
      },
    ],
  }))
} finally {
  db.close()
}
const runtime = spawn('node', [join(root, 'apps/api/dist/index.js')], {
  env: {
    ...process.env,
    DOVO_DATABASE_PATH: join(directory, 'runtime.sqlite'),
    DOVO_HOST: '127.0.0.1',
    PORT: '0',
    ELECTRON_RUN_AS_NODE: undefined,
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
let diagnostics = ''
runtime.stderr.on('data', (chunk) => (diagnostics = (diagnostics + chunk).slice(-4000)))
const exited = new Promise((resolveExit) => runtime.once('exit', resolveExit))
const assets = join(root, 'apps/desktop/dist')
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const file = resolve(assets, '.' + path, path.endsWith('/') ? 'index.html' : '')
  if (!file.startsWith(assets + sep)) {
    response.writeHead(403).end()
    return
  }
  try {
    response
      .writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' })
      .end(await readFile(file))
  } catch {
    response.writeHead(404).end()
  }
})
let browser
try {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Capture runtime startup timed out: ${diagnostics}`)),
      15000,
    )
    runtime.once('message', () => {
      clearTimeout(timeout)
      resolveReady()
    })
    runtime.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    runtime.once('exit', () => {
      clearTimeout(timeout)
      reject(new Error(diagnostics))
    })
  })
  const connection = JSON.parse(await readFile(join(directory, 'runtime-connection.json'), 'utf8'))
  const profile = { ...runtimeProfile(connection), name: 'Local computer', nameIsCustom: true }
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1500, height: 980 },
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript((profile) => {
    localStorage.setItem(
      'dovo.runtimes.v1',
      JSON.stringify({ version: 1, activeId: profile.id, profiles: [profile] }),
    )
    localStorage.setItem(
      'dovo.app-preferences.v1',
      JSON.stringify({
        theme: 'dark',
        themePalette: 'dovo',
        motion: 'reduce',
        providerUpdateChecks: false,
        lastThreadId: `${profile.id}:project-picker`,
      }),
    )
  }, profile)
  await page.goto(`http://127.0.0.1:${address.port}/`)
  await page.getByText('Make adding projects feel natural', { exact: true }).first().waitFor()
  await page.getByText('Make adding projects feel natural', { exact: true }).first().click()
  await page
    .getByText('The project picker now starts the add flow from the toolbar.', { exact: false })
    .waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(root, 'apps/site/public/screenshots/workbench.png') })
  await page.getByRole('button', { name: 'Automations', exact: true }).click()
  await page.getByText('Morning repository review', { exact: true }).first().waitFor()
  await page.getByText('Morning repository review', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  await page.getByText('Every weekday', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: /fit view/i }).click()
  await page.waitForFunction(
    () => (document.querySelector('.react-flow__node')?.getBoundingClientRect().width ?? 0) > 180,
  )
  assert.equal(await page.getByText('1 issue to fix before running', { exact: true }).count(), 0)
  await page.screenshot({ path: join(root, 'apps/site/public/screenshots/automations.png') })
  assert.deepEqual(errors, [])
  console.log(
    'Captured the actual Dovo Studio workbench and automation editor using an isolated demo runtime.',
  )
} finally {
  await browser?.close()
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose))
  if (runtime.exitCode === null && runtime.signalCode === null) {
    runtime.kill('SIGTERM')
    await exited
  }
  await rm(directory, { recursive: true, force: true })
}
