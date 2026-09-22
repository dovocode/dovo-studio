import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
const device = process.argv[2]
const issuesOnly = process.argv.includes('--issues-only')
if (!device) throw new Error('Pass an iOS simulator UUID')
const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-work-'))
const runtime = await startRuntime({
  databasePath: ':memory:',
  ownerToken: randomBytes(32).toString('base64url'),
  host: '127.0.0.1',
  port: 0,
})
const writes = [],
  comments = []
const issue = {
  id: '1',
  title: 'Mobile issue workflow',
  body: '## Details\n\nCheck `inline code` and **strong text**.',
  state: 'open',
  type: 'Issue',
  url: 'https://github.com/fixture/project/issues/1',
  author: 'developer',
  assignees: [],
  labels: [],
  updatedAt: '2026-09-20T10:00:00Z',
  revision: '1',
  bodyFormat: 'markdown',
}
const run = {
  id: '42',
  title: 'Mobile pipeline workflow',
  url: 'https://github.com/fixture/project/actions/runs/42',
  ref: 'main',
  sha: 'a'.repeat(40),
  actor: 'developer',
  status: 'failure',
  createdAt: '2026-09-20T10:00:00Z',
  updatedAt: '2026-09-20T10:00:00Z',
  definition: '1',
  number: '256',
  attempt: 2,
  event: 'push',
  workflow: 'Continuous integration',
  commitMessage: 'Preserve selected runtime in new tasks',
  startedAt: '2026-09-20T10:00:00Z',
  completedAt: '2026-09-20T10:05:00Z',
  errors: ['Run failed after a test error.'],
}
runtime.services.store.update((w) => ({
  ...w,
  repositories: [{ id: 'work', name: 'Mobile work fixture', path: directory, branch: 'main' }],
}))
runtime.services.forgeWork.request = async (_repository, operation, input) => {
  if (operation === 'options')
    return {
      provider: 'github',
      issues: true,
      issueTypes: ['Issue'],
      issueStates: ['open', 'closed'],
      issueSearch: true,
      assignees: true,
      labels: true,
      pipelines: true,
      pipelineActions: ['run', 'rerun', 'cancel'],
    }
  if (operation === 'issues/list') {
    const older = {
      ...issue,
      id: '2',
      title: 'Mobile older issue',
      url: 'https://github.com/fixture/project/issues/2',
      updatedAt: '2026-09-19T10:00:00Z',
    }
    if (input.query)
      return {
        items: [issue, older].filter((item) =>
          item.title.toLowerCase().includes(input.query.toLowerCase()),
        ),
      }
    return input.cursor === 'older' ? { items: [older] } : { items: [issue], next: 'older' }
  }
  if (operation === 'issues/detail') return { issue, comments }
  if (operation === 'issues/action') {
    writes.push(input)
    comments.push({
      id: String(comments.length + 1),
      body: input.body,
      author: 'developer',
      createdAt: '2026-09-20T11:00:00Z',
      bodyFormat: 'markdown',
    })
    return { message: 'Comment posted' }
  }
  if (operation === 'pipelines/list') return { items: [run] }
  if (operation === 'pipelines/detail')
    return {
      run,
      jobs: [
        {
          id: '1',
          name: 'Build and test',
          status: 'failure',
          url: run.url,
          runner: 'linux-test-runner',
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          errors: ['Process completed with exit code 1.'],
          steps: [
            {
              id: 'checkout',
              number: 1,
              name: 'Checkout source',
              status: 'success',
              startedAt: run.startedAt,
              completedAt: '2026-09-20T10:00:30Z',
            },
            {
              id: 'tests',
              number: 2,
              name: 'Run unit tests',
              status: 'failure',
              startedAt: '2026-09-20T10:00:30Z',
              completedAt: run.completedAt,
              errors: ['Expected the selected runtime to remain connected.'],
            },
          ],
        },
        { id: '2', name: 'Upload artifacts', status: 'skipped', url: run.url },
      ],
    }
  if (operation === 'pipelines/definitions')
    return { items: [{ id: '1', name: 'CI' }], manual: false }
  if (operation === 'pipelines/action') {
    writes.push(input)
    return { message: 'Pipeline submitted' }
  }
  throw new Error('Unexpected fixture operation ' + operation)
}
const profileReads = []
let checkoutDiscoveries = 0
runtime.services.forgeCli.profiles = async (query, cwd) => {
  profileReads.push({ query, cwd })
  if (query.repositoryId && ++checkoutDiscoveries > 1)
    throw new Error('Fixture CLI discovery unavailable')
  return {
    profiles: [
      { id: 'personal', name: 'Personal', active: true },
      { id: 'work', name: 'Work', username: 'developer' },
    ],
  }
}
let runtimeClosed = false
const approve = setInterval(() => {
  for (const request of runtime.services.pairing.pending())
    if (request.name === 'Dovo simulator test') runtime.services.pairing.approve(request.id, true)
}, 250)
try {
  const nativeTabSelectors = (flow) =>
    flow.replace(
      /^(\s*)id: Tab (.+)$/gm,
      (_match, indent, label) =>
        `${indent}text: ${label}\n${indent}childOf:\n${indent}  text: Tab Bar`,
    )
  // Native tab accessibility exposes labels without React test IDs in Release builds.
  for (const name of ['open-settings', 'open-devices', 'reset-computers'])
    await writeFile(
      join(directory, `${name}.yaml`),
      nativeTabSelectors(await readFile(`apps/mobile/maestro/${name}.yaml`, 'utf8')),
    )
  const base = await readFile('apps/mobile/maestro/pulls.yaml', 'utf8')
  const prefix = base.slice(
    0,
    base.indexOf("- extendedWaitUntil:\n    visible: '.*Fix second runtime.*'"),
  )
  const fullFlow = nativeTabSelectors(
    prefix.replace(
      'reset-computers.yaml',
      JSON.stringify(join(directory, 'reset-computers.yaml')),
    ) + (await readFile('apps/mobile/maestro/work.yaml', 'utf8')).split('---\n')[1],
  )
  const overviewScreenshot = '- takeScreenshot: dovo-mobile-issues-tab'
  const flow = issuesOnly
    ? `${fullFlow.slice(0, fullFlow.indexOf(overviewScreenshot) + overviewScreenshot.length)}\n- runFlow: ${JSON.stringify(join(directory, 'reset-computers.yaml'))}\n`
    : fullFlow
  const file = join(directory, 'work.yaml')
  await writeFile(file, flow)
  const child = spawn(
    'maestro',
    [
      '--device',
      device,
      'test',
      '-e',
      `RUNTIME_ADDRESS=http://127.0.0.1:${runtime.port}`,
      '-e',
      `PAIRING_CODE=${runtime.services.pairing.createCode().code}`,
      '-e',
      `RUNTIME_ID=${encodeURIComponent(`http://127.0.0.1:${runtime.port}`)}`,
      '-e',
      `RUN_SHA=${run.sha}`,
      file,
    ],
    { stdio: 'inherit' },
  )
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (status !== 0) throw new Error('Mobile work flow failed')
  if (issuesOnly) {
    if (writes.length || runtime.services.store.get().tasks.some((task) => task.workItem))
      throw new Error('Issues overview verification unexpectedly changed source work')
    console.log('Native Issues tab, readable state filter and singular count verified.')
  } else {
    if (
      writes.length !== 2 ||
      writes[0].body !== 'Mobile fixture comment' ||
      writes[1].ref !== 'main'
    )
      throw new Error('Unexpected submissions ' + JSON.stringify(writes))
    const linkedTasks = runtime.services.store.get().tasks.filter((task) => task.workItem)
    if (
      linkedTasks.length !== 3 ||
      linkedTasks.filter((task) => task.workItem.kind === 'issue').length !== 2 ||
      linkedTasks.some(
        (task) => task.status !== 'draft' || task.messages.length || task.repositoryId !== 'work',
      )
    )
      throw new Error('Linked work tasks did not remain draft tasks')
    const issueTask = linkedTasks.find((task) => task.workItem.kind === 'issue')
    const pipelineTask = linkedTasks.find((task) => task.workItem.kind === 'pipeline')
    if (
      !issueTask?.draft.includes('Mobile fixture comment') ||
      !pipelineTask?.draft.includes(run.sha) ||
      !pipelineTask.draft.includes('Build and test')
    )
      throw new Error('Linked task source context is incomplete')
    const github = runtime.services.forges
      .list()
      .find((connection) => connection.provider === 'github')
    if (github?.cliProfile !== 'work') throw new Error('Native CLI profile selection was not saved')
    if (!profileReads.some(({ query, cwd }) => query.repositoryId === 'work' && cwd === directory))
      throw new Error('Native profile discovery did not use the project checkout')
    // Popping a native detail unmounts it. Verify offline reopening hydrates the same
    // source-bound cache without issuing actions or depending on hidden mounted detail state.
    await runtime.close()
    runtimeClosed = true
    clearInterval(approve)
    const offlineFlow = join(directory, 'work-offline.yaml')
    await writeFile(
      offlineFlow,
      nativeTabSelectors(await readFile('apps/mobile/maestro/work-offline.yaml', 'utf8')),
    )
    const offline = spawn(
      'maestro',
      [
        '--device',
        device,
        'test',
        '-e',
        `RUN_SHA=${run.sha}`,
        '-e',
        `RUNTIME_ID=${encodeURIComponent(`http://127.0.0.1:${runtime.port}`)}`,
        offlineFlow,
      ],
      { stdio: 'inherit' },
    )
    const offlineStatus = await new Promise((resolve, reject) => {
      offline.once('error', reject)
      offline.once('exit', resolve)
    })
    if (offlineStatus !== 0) throw new Error('Mobile offline work reopening failed')
    if (writes.length !== 2) throw new Error('Offline work submitted a mutation')
    console.log(
      'Native issue/pipeline detail routes, retained collection filters, host/source guards, linked drafts, pipeline details/actions, CLI checkout fallback and offline detail reopening verified.',
    )
  }
} finally {
  clearInterval(approve)
  try {
    execFileSync('xcrun', ['simctl', 'terminate', device, 'com.dovo.studio'])
  } catch (error) {
    console.warn('Simulator app was not running during cleanup:', error.message)
  }
  if (!runtimeClosed) await runtime.close()
  await rm(directory, { recursive: true, force: true })
}
