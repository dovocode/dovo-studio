import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { runtimeProfile } from '../packages/protocol/dist/index.js'

// Production workbench and HTTP API, isolated demo data, no providers or agents started.
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dovo-do-capture-'))
const ownerToken = randomUUID() + randomUUID()
const assets = join(root, 'apps/desktop/dist')
let runtime
let browser
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const file = resolve(assets, '.' + path, path.endsWith('/') ? 'index.html' : '')
  if (!file.startsWith(assets + sep)) return response.writeHead(403).end()
  try {
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
    }
    response
      .writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
      .end(await readFile(file))
  } catch {
    response.writeHead(404).end()
  }
})
try {
  const checkout = join(directory, 'project')
  await mkdir(checkout)
  execFileSync('git', ['init', '-q', '-b', 'main', checkout])
  await writeFile(join(checkout, 'README.md'), '# Demo project\n')
  execFileSync('git', ['-C', checkout, 'add', '.'])
  execFileSync('git', [
    '-C',
    checkout,
    '-c',
    'user.name=Demo',
    '-c',
    'user.email=demo@example.invalid',
    'commit',
    '-qm',
    'Demo project',
  ])
  runtime = await startRuntime({
    databasePath: join(directory, 'runtime.sqlite'),
    ownerToken,
    port: 0,
  })
  const s = runtime.services
  s.preferences.save({ enableDo: true })
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'studio', name: 'Dovo Studio · demo', path: checkout, branch: 'main' }],
    agents: [
      {
        id: 'sol',
        name: 'Sol',
        provider: 'codex',
        model: 'gpt-6.1-sol',
        reasoning: 'high',
        permission: 'ask',
        instructions: '',
        endpoint: '',
      },
    ],
    tasks: [],
    automations: [],
  }))
  const task = s.tasks.create({
    title: 'DEMO · Coordinate pairing improvements',
    repositoryId: 'studio',
    agentId: 'sol',
    objective: '',
    origin: 'do-chat',
    execution: 'main',
  })
  const now = new Date().toISOString()
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    status: 'review',
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        text: 'DEMO · Improve pairing recovery on desktop and mobile. Preserve HTTP over LAN and VPN. Prepare the changes for review, but do not merge.',
        createdAt: now,
      },
      {
        id: randomUUID(),
        role: 'assistant',
        text: 'I’ve proposed two focused work items: improve reconnect guidance, then verify the recovery flow. Review the saved proposal before starting.\n\nThis is illustrative demo data; no agents have been started.',
        createdAt: now,
      },
    ],
  }))
  s.db
    .prepare('INSERT INTO do_chats (request_id, task_id, fingerprint, created_at) VALUES (?,?,?,?)')
    .run(randomUUID(), task.id, 'demo-fixture', now)
  const post = async (path, input) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  const { run } = await post('/api/do/save', {
    id: randomUUID(),
    title: 'DEMO · Improve pairing recovery',
    goal: 'Make reconnecting to a paired computer clear and reliable on desktop and mobile. Preserve required pairing and HTTP LAN/VPN support. Return verification evidence for review; never merge automatically.',
    maxConcurrency: 2,
    items: [
      {
        id: 'reconnect',
        title: 'Improve reconnect guidance',
        instructions:
          'Inspect the desktop and mobile reconnect flows. Improve recovery guidance and test offline and invalid-token states. Commit the result locally and report its branch and commit so the dependent item can explicitly access it. Do not push or merge.',
        dependsOn: [],
        target: {
          runtimeId: 'local',
          repositoryId: 'studio',
          agentId: 'sol',
          execution: 'worktree',
        },
      },
      {
        id: 'verify',
        title: 'Verify recovery and report evidence',
        instructions:
          'Read the upstream result. Fetch the exact reported local commit into the verification worktree before testing. Check desktop and mobile recovery, pairing security and HTTP runtime connections. Return checks, screenshots and remaining limits. Ask if the earlier code is unavailable.',
        dependsOn: ['reconnect'],
        target: {
          runtimeId: 'local',
          repositoryId: 'studio',
          agentId: 'sol',
          execution: 'worktree',
        },
      },
    ],
  })
  s.db
    .prepare('INSERT INTO do_chat_runs (run_id, task_id, created_at) VALUES (?,?,?)')
    .run(run.id, task.id, now)
  const profile = {
    ...runtimeProfile({
      address: `http://127.0.0.1:${runtime.port}`,
      token: ownerToken,
      runtimeId: s.runtimeId,
    }),
    name: 'Demo workstation',
    nameIsCustom: true,
  }
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
    deviceScaleFactor: 1,
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(
    ({ profile, taskId }) => {
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
          lastThreadId: `${profile.id}:${taskId}`,
        }),
      )
    },
    { profile, taskId: task.id },
  )
  await page.goto(`http://127.0.0.1:${address.port}/`)
  await page.getByText(task.title, { exact: true }).first().waitFor()
  await page.getByText(task.title, { exact: true }).first().click()
  await page.getByRole('button', { name: 'Review proposal', exact: true }).waitFor()
  await page
    .getByText('This is illustrative demo data; no agents have been started.', { exact: false })
    .waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(root, 'docs/screenshots/do/desktop-workbench-chat.png') })
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click()
  await page.getByRole('button', { name: 'Start plan', exact: true }).waitFor()
  await page.getByText('Verify recovery and report evidence', { exact: true }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(root, 'docs/screenshots/do/desktop-workbench-proposal.png') })
  assert.equal(s.doRuns.read(run.id).status, 'draft')
  assert.equal(s.store.get().tasks.length, 1)
  assert.deepEqual(errors, [])
  console.log(
    'Production Do workbench: conversation-owned proposal loads over paired HTTP, opens exact saved review, and stays unstarted. Two demo screenshots captured; no agents invoked.',
  )
} finally {
  await browser?.close()
  if (server.listening) await new Promise((done) => server.close(done))
  await runtime?.close()
  await rm(directory, { recursive: true, force: true })
}
