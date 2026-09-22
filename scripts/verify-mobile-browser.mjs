import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'

const device = process.argv[2]
const screensOnly = process.argv.includes('--screens-only')
const foldersOnly = process.argv.includes('--folders-only')
const remainingOnly = process.argv.includes('--remaining-only')
if (!device) throw new Error('Pass an iOS simulator UUID')
const directory = await realpath(await mkdtemp(join(tmpdir(), 'dovo-mobile-browser-')))
const folders = join(directory, 'folders')
const repository = join(directory, 'first')
const reads = []
const runtime = await startRuntime({
  databasePath: ':memory:',
  ownerToken: randomBytes(32).toString('base64url'),
  host: '127.0.0.1',
  port: 0,
})
let retryAttempts = 0
const proxy = createServer(async (incoming, outgoing) => {
  const chunks = []
  for await (const chunk of incoming) chunks.push(chunk)
  const body = Buffer.concat(chunks)
  if (incoming.url === '/api/scm/directories/read') {
    const input = JSON.parse(body.toString())
    reads.push(input)
    if (input.path === join(folders, 'retry') && ++retryAttempts === 1) {
      outgoing.writeHead(503, { 'content-type': 'application/json' })
      outgoing.end(JSON.stringify({ error: 'Fixture folder temporarily unavailable. Retry.' }))
      return
    }
  }
  const upstream = request(
    {
      hostname: '127.0.0.1',
      port: runtime.port,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 500, response.headers)
      response.pipe(outgoing)
    },
  )
  upstream.on('error', (error) => {
    outgoing.writeHead(502)
    outgoing.end(error.message)
  })
  upstream.end(body)
})
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
const address = proxy.address()
if (!address || typeof address === 'string') throw new Error('Fixture proxy failed to listen')
const approve = setInterval(() => {
  for (const pending of runtime.services.pairing.pending())
    if (pending.name === 'Dovo simulator test') runtime.services.pairing.approve(pending.id, true)
}, 250)
try {
  await mkdir(repository)
  await mkdir(folders)
  await Promise.all(
    [
      ...Array.from({ length: 101 }, (_, index) => `folder${index + 1}`),
      '.hidden',
      'empty',
      'retry',
    ].map((name) => mkdir(join(folders, name))),
  )
  execFileSync('git', ['init', '-q'], { cwd: repository })
  runtime.services.commands.save({
    ...runtime.services.commands.get(),
    gh: resolve('scripts/fixtures/github.cjs'),
    codex: resolve('scripts/fixtures/codex.cjs'),
  })
  runtime.services.forges.save({
    name: 'Fixture GitHub',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'gh',
  })
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [
      { id: 'browser-repo', name: 'Mobile browser fixture', path: repository, branch: 'main' },
    ],
    agents: [
      {
        id: 'browser-agent',
        name: 'Mobile agent',
        provider: 'codex',
        model: '',
        permission: 'ask',
        endpoint: '',
        instructions: '',
      },
    ],
    tasks: [
      {
        id: 'browser-task',
        title: 'Review file browser and screen navigation',
        repositoryId: 'browser-repo',
        agentId: 'browser-agent',
        status: 'review',
        createdAt: new Date().toISOString(),
        messages: [
          {
            id: 'message',
            role: 'assistant',
            text: 'Review the folder picker and changed-file navigation.',
          },
        ],
        draft: '',
        example: false,
        files: Array.from({ length: 14 }, (_, index) => ({
          path: `packages/runtime/src/connections/remote-device-recovery-${index + 1}.ts`,
          before: 'export const ready = false\n',
          after: 'export const ready = true\n',
          viewed: false,
        })),
      },
    ],
    automations: [
      {
        id: 'browser-job',
        name: 'Review repository changes',
        enabled: false,
        nodes: [
          {
            id: 'start',
            type: 'automation',
            position: { x: 0, y: 0 },
            data: {
              kind: 'trigger',
              label: 'Start',
              trigger: 'manual',
              schedule: '0 9 * * 1-5',
              timezone: 'Europe/Amsterdam',
              objective: '',
              repositoryId: 'browser-repo',
              agentId: 'browser-agent',
              execution: 'main',
            },
          },
          {
            id: 'review',
            type: 'automation',
            position: { x: 300, y: 0 },
            data: {
              kind: 'task',
              trigger: 'manual',
              schedule: '0 9 * * 1-5',
              timezone: 'Europe/Amsterdam',
              label: 'Review',
              objective: 'Review changes',
              repositoryId: 'browser-repo',
              agentId: 'browser-agent',
              execution: 'main',
            },
          },
        ],
        edges: [{ id: 'edge', source: 'start', target: 'review' }],
      },
    ],
  }))
  const issue = {
    id: '1',
    title: 'Verify compact mobile navigation',
    body: 'Check folder selection and source context.',
    state: 'open',
    type: 'Issue',
    url: 'https://github.com/test/first/issues/1',
    author: 'developer',
    assignees: [],
    labels: [],
    updatedAt: '2026-09-20T12:00:00Z',
    revision: '1',
    bodyFormat: 'markdown',
  }
  const run = {
    id: '42',
    number: '256',
    title: 'Validate mobile folder browsing',
    status: 'success',
    url: 'https://github.com/test/first/actions/runs/42',
    ref: 'main',
    sha: 'a'.repeat(40),
    actor: 'developer',
    workflow: 'Mobile checks',
    event: 'push',
    createdAt: '2026-09-20T12:00:00Z',
    updatedAt: '2026-09-20T12:02:00Z',
    startedAt: '2026-09-20T12:00:00Z',
    completedAt: '2026-09-20T12:02:00Z',
  }
  runtime.services.forgeWork.request = async (_repository, operation) => {
    if (operation === 'options')
      return {
        provider: 'github',
        issues: true,
        issueTypes: ['Issue'],
        issueStates: ['open', 'closed'],
        assignees: true,
        labels: true,
        pipelines: true,
        pipelineActions: ['run', 'rerun', 'cancel'],
      }
    if (operation === 'issues/list') return { items: [issue] }
    if (operation === 'issues/detail') return { issue, comments: [] }
    if (operation === 'pipelines/list') return { items: [run] }
    if (operation === 'pipelines/detail')
      return {
        run,
        jobs: [
          {
            id: 'job',
            name: 'Native checks',
            status: 'success',
            url: run.url,
            runner: 'macOS',
            steps: [{ id: 'step', name: 'Verify folder selection', status: 'success' }],
          },
        ],
      }
    throw new Error('Unexpected operation: ' + operation)
  }
  const nativeTabs = (flow) =>
    flow.replace(
      /^(\s*)id: Tab (.+)$/gm,
      (_match, indent, label) =>
        `${indent}text: ${label}\n${indent}childOf:\n${indent}  text: Tab Bar`,
    )
  for (const name of ['open-settings', 'open-devices', 'reset-computers'])
    await writeFile(
      join(directory, name + '.yaml'),
      nativeTabs(await readFile(`apps/mobile/maestro/${name}.yaml`, 'utf8')),
    )
  const base = await readFile('apps/mobile/maestro/pulls.yaml', 'utf8')
  const prefix = base
    .slice(0, base.indexOf('- tapOn:\n    id: Tab PRs'))
    .replace('- launchApp', '- launchApp:\n    stopApp: true')
  const flow = join(directory, 'browser.yaml')
  const walkthrough = await readFile('apps/mobile/maestro/browser.yaml', 'utf8')
  const divider = walkthrough.indexOf('- tapOn:\n    id: Task browser-task')
  const folderActions = walkthrough.indexOf('# Remaining folder actions')
  if (divider < 0 || folderActions < 0 || !walkthrough.includes('- tapOn: Terminal'))
    throw new Error('Mobile fixture section markers are missing')
  const remainingFlow =
    walkthrough.slice(
      0,
      walkthrough.indexOf('- scrollUntilVisible:\n    element:\n      text: Load more folders'),
    ) +
    walkthrough.slice(folderActions, walkthrough.indexOf('- tapOn: Terminal')) +
    `
- tapOn: Back
- tapOn:
    id: Tab PRs
- extendedWaitUntil:
    visible: '.*Fix first runtime.*'
    timeout: 15000
- tapOn: '.*Fix first runtime.*'
- extendedWaitUntil:
    visible: Runtime fix
    timeout: 15000
- tapOn: Files
- extendedWaitUntil:
    visible: runtime.ts · src
    timeout: 15000
- assertVisible: 0 of 1 file viewed
- takeScreenshot: dovo-mobile-final-pull-files
- tapOn: Back
- tapOn:
    id: Tab Automations
- assertVisible: Manual · 1 step
- takeScreenshot: dovo-mobile-final-jobs
- runFlow: reset-computers.yaml
`
  const selectedFlow = remainingOnly
    ? remainingFlow
    : screensOnly
      ? '- tapOn:\n    id: Tab Tasks\n' + walkthrough.slice(divider)
      : foldersOnly
        ? walkthrough.slice(0, divider) + '- runFlow: reset-computers.yaml\n'
        : walkthrough
  await writeFile(flow, nativeTabs(prefix + selectedFlow))
  const child = spawn(
    'maestro',
    [
      '--device',
      device,
      'test',
      '-e',
      `RUNTIME_ADDRESS=http://127.0.0.1:${address.port}`,
      '-e',
      `PAIRING_CODE=${runtime.services.pairing.createCode().code}`,
      '-e',
      `BROWSER_DIRECTORY=${folders}`,
      flow,
    ],
    { stdio: 'inherit' },
  )
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (status !== 0 && process.argv.includes('--hold-on-failure')) {
    console.log(
      `Fixture retained for inspection at ${directory}; send SIGINT to ${process.pid} to clean up.`,
    )
    await new Promise((resolve) => process.once('SIGINT', resolve))
  }
  if (status !== 0) throw new Error('Mobile browser walkthrough failed')
  if (
    !screensOnly &&
    ((!remainingOnly &&
      (!reads.some((input) => input.offset === 100) ||
        !reads.some((input) => input.query === 'folder2'))) ||
      !reads.some((input) => input.hidden) ||
      retryAttempts !== 2)
  )
    throw new Error('Folder paging, filtering, hidden-folder or retry coverage missing')
  const workspace = runtime.services.store.get()
  if (
    workspace.repositories.length !== 1 ||
    workspace.tasks.length !== 1 ||
    workspace.automations.length !== 1
  )
    throw new Error('Walkthrough unexpectedly saved a draft form')
  console.log(
    remainingOnly
      ? 'Native hidden folders, errors/retry, canonical selection, project form error and final file/count controls passed.'
      : screensOnly
        ? 'Native primary screens, editors and clone folder selection walkthrough passed.'
        : foldersOnly
          ? 'Native folder navigation/filter/hidden/paging/retry/selection passed.'
          : 'Native folder browser and primary screen walkthrough passed.',
  )
} finally {
  clearInterval(approve)
  try {
    execFileSync('xcrun', ['simctl', 'terminate', device, 'com.dovo.studio'])
  } catch (error) {
    console.warn('Simulator already stopped:', error.message)
  }
  proxy.closeAllConnections()
  await new Promise((resolve) => proxy.close(resolve))
  await runtime.close()
  await rm(directory, { recursive: true, force: true })
}
