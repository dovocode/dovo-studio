import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

const device = process.argv[2]
if (!device) throw new Error('Pass an isolated iOS simulator UUID with the native app installed')
const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-collections-'))
const runtimes = []
const writes = []
const time = '2026-09-20T10:00:00Z'
async function fixture(name) {
  const path = join(directory, name)
  await mkdir(path)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: randomBytes(32).toString('base64url'),
    host: '127.0.0.1',
    port: 0,
  })
  runtimes.push(runtime)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'shared-project', name: `${name} project`, path, branch: 'main' }],
    automations: [
      { id: 'shared-automation', name: `${name} automation`, nodes: [], edges: [], enabled: false },
    ],
  }))
  const issue = {
    id: '1',
    title: `${name} issue`,
    body: `${name} host details`,
    state: 'open',
    url: `https://github.com/${name.toLowerCase()}/project/issues/1`,
    author: 'developer',
    assignees: [],
    labels: [],
    updatedAt: time,
    revision: '1',
    bodyFormat: 'markdown',
  }
  const comments = []
  const run = {
    id: '1',
    title: `${name} pipeline`,
    url: `https://github.com/${name.toLowerCase()}/project/actions/runs/1`,
    ref: 'main',
    sha: 'a'.repeat(40),
    actor: 'developer',
    status: 'failure',
    createdAt: time,
    updatedAt: time,
  }
  runtime.services.forgeWork.request = async (_repository, operation, input) => {
    if (operation === 'options')
      return {
        provider: 'github',
        issues: true,
        issueTypes: ['Issue'],
        issueStates: ['open', 'closed'],
        assignees: true,
        labels: true,
        pipelines: true,
        pipelineActions: ['run'],
      }
    if (operation === 'issues/list') return { items: [issue] }
    if (operation === 'issues/detail') return { issue, comments }
    if (operation === 'issues/action') {
      writes.push({ name, ...input })
      comments.push({
        id: String(comments.length + 1),
        author: 'developer',
        body: input.body,
        createdAt: time,
        bodyFormat: 'markdown',
      })
      return { message: 'Comment posted' }
    }
    if (operation === 'pipelines/list') return { items: [run] }
    if (operation === 'pipelines/detail') return { run, jobs: [] }
    throw new Error(`Unexpected fixture operation ${operation}`)
  }
  runtime.services.pullCache.list = async () => ({
    pulls: [
      {
        number: 1,
        title: `${name} pull request`,
        url: `https://github.com/${name.toLowerCase()}/project/pull/1`,
        state: 'open',
        draft: false,
        author: 'developer',
        updatedAt: time,
        head: 'feature',
        base: 'main',
        labels: [],
        viewerReviewRequested: true,
      },
    ],
    hasMore: false,
    page: 1,
  })
  return runtime
}
const native = (flow) =>
  flow.replace(
    /^(\s*)id: Tab (.+)$/gm,
    (_match, indent, label) =>
      `${indent}text: ${label}\n${indent}childOf:\n${indent}  text: Tab Bar`,
  )
async function flow(name, text, environment = {}) {
  const path = join(directory, `${name}.yaml`)
  await writeFile(path, native(text))
  const child = spawn(
    'maestro',
    [
      '--device',
      device,
      'test',
      ...Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      path,
    ],
    { stdio: 'inherit' },
  )
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (status !== 0) throw new Error(`Unified collection verification failed: ${name}`)
}
try {
  const first = await fixture('First'),
    second = await fixture('Second')
  for (const name of ['open-settings', 'open-devices', 'reset-computers'])
    await writeFile(
      join(directory, `${name}.yaml`),
      native(await readFile(`apps/mobile/maestro/${name}.yaml`, 'utf8')),
    )
  const firstPair = await readFile('apps/mobile/maestro/multi-device-first.yaml', 'utf8')
  await flow('pair-first', firstPair.slice(0, firstPair.indexOf('- tapOn:\n    id: Tab Tasks')), {
    FIRST_ADDRESS: `http://127.0.0.1:${first.port}`,
    FIRST_CODE: first.services.pairing.createCode(true).code,
  })
  const secondPair = await readFile('apps/mobile/maestro/multi-device.yaml', 'utf8')
  await flow(
    'pair-second',
    secondPair.slice(0, secondPair.indexOf('- tapOn:\n    id: Tab Tasks')),
    {
      SECOND_ADDRESS: `http://127.0.0.1:${second.port}`,
      SECOND_CODE: second.services.pairing.createCode(true).code,
    },
  )
  await flow(
    'collections',
    `appId: com.dovo.studio
---
- tapOn:
    id: Tab Issues
- extendedWaitUntil:
    visible: '.*First issue.*'
    timeout: 20000
- assertVisible: '.*Second issue.*'
- assertNotVisible:
    id: Selected computer
- tapOn: '.*First issue.*'
- extendedWaitUntil:
    visible: First host details
    timeout: 15000
- assertNotVisible: Second host details
- assertNotVisible: Open computer
- tapOn: Work actions
- tapOn: Comment
- tapOn:
    id: Description
- inputText: Comment on first computer
- tapOn: Dismiss keyboard
- tapOn: Submit
- extendedWaitUntil:
    visible: Comment on first computer
    timeout: 15000
- tapOn: Back
- assertVisible: '.*First issue.*'
- assertVisible: '.*Second issue.*'
- tapOn: '.*Second issue.*'
- extendedWaitUntil:
    visible: Second host details
    timeout: 15000
- assertNotVisible: Comment on first computer
- tapOn: Back
- tapOn:
    id: Tab PRs
- extendedWaitUntil:
    visible: '.*First pull request.*'
    timeout: 15000
- assertVisible: '.*Second pull request.*'
- assertNotVisible:
    id: Selected computer
- takeScreenshot: dovo-mobile-unified-pulls
- tapOn: Pipelines
- extendedWaitUntil:
    visible: '.*First pipeline.*'
    timeout: 15000
- assertVisible: '.*Second pipeline.*'
- tapOn: '.*First pipeline.*'
- extendedWaitUntil:
    visible: '.*First pipeline.*'
    timeout: 15000
- assertNotVisible: '.*Second pipeline.*'
- tapOn: Back
- assertVisible: '.*First pipeline.*'
- assertVisible: '.*Second pipeline.*'
- tapOn:
    id: Tab Automations
- extendedWaitUntil:
    visible: '.*First automation.*'
    timeout: 15000
- assertVisible: '.*Second automation.*'
- assertNotVisible:
    id: Selected computer
- tapOn: '.*First automation.*'
- extendedWaitUntil:
    visible: Back to automations
    timeout: 15000
- assertVisible: First Mac
- tapOn: Back to automations
- assertVisible: '.*Second automation.*'
- takeScreenshot: dovo-mobile-unified-automations
- tapOn:
    id: Tab Issues
- assertVisible: '.*First issue.*'
- assertVisible: '.*Second issue.*'
- takeScreenshot: dovo-mobile-unified-issues
`,
  )
  if (
    writes.length !== 1 ||
    writes[0].name !== 'First' ||
    writes[0].body !== 'Comment on first computer'
  )
    throw new Error('Mutation crossed computer boundaries: ' + JSON.stringify(writes))
  await first.close()
  runtimes.splice(runtimes.indexOf(first), 1)
  await flow(
    'offline-and-forget',
    `appId: com.dovo.studio
---
- extendedWaitUntil:
    visible:
      id: Connection details
    timeout: 40000
- assertVisible: '.*First issue.*'
- assertVisible: '.*Second issue.*'
- tapOn: '.*Second issue.*'
- extendedWaitUntil:
    visible: Second host details
    timeout: 15000
- tapOn: Back
- runFlow: open-devices.yaml
- tapOn: Manage First Mac
- scrollUntilVisible:
    element:
      id: Forget computer
    direction: DOWN
    centerElement: true
- tapOn: Forget computer
- tapOn:
    id: Tab Issues
- assertVisible: '.*Second issue.*'
- assertNotVisible: '.*First issue.*'
- takeScreenshot: dovo-mobile-unified-offline
- runFlow: reset-computers.yaml
`,
  )
  console.log(
    'Unified issues, PRs, pipelines and automations; automatic host routing; isolated mutations; offline retention and forgetting verified.',
  )
} finally {
  await Promise.all(runtimes.map((runtime) => runtime.close()))
  await rm(directory, { recursive: true, force: true })
}
