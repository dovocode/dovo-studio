import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'

const device = process.argv[2]
const terminalOnly = process.argv.includes('--terminal-only')
const composerOnly = process.argv.includes('--composer-only')
const navigationOnly = process.argv.includes('--navigation-only')
const conversationOnly = process.argv.includes('--conversation-only')
const dictationOnly = process.argv.includes('--dictation-only')
const jobsOnly = process.argv.includes('--jobs-only')
const modesOnly = process.argv.includes('--modes-only')
const settingsOnly = process.argv.includes('--settings-only')
const previousLongCatalog = process.env.DOVO_FIXTURE_CODEX_LONG_CATALOG
if (modesOnly) process.env.DOVO_FIXTURE_CODEX_LONG_CATALOG = '1'
const modeSaves = []
const settingsSaves = []
const jobAttempts = []
const jobStartIds = []
if (!device) throw new Error('Pass an iOS simulator UUID with the native app installed')
const appData = execFileSync(
  'xcrun',
  ['simctl', 'get_app_container', device, 'com.dovo.studio', 'data'],
  { encoding: 'utf8' },
).trim()
await writeFile(join(appData, 'Documents', 'dovo-attachment.txt'), 'Attachment fixture context')
const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-check-'))
const runtime = await startRuntime({
  databasePath: ':memory:',
  ownerToken: randomBytes(32).toString('base64url'),
  port: 0,
})
let approve
let settingsProxy
let terminalConnected = false
const composerMessageAttempts = []
const composerRetryAttempts = []
if (composerOnly) {
  const send = runtime.services.tasks.send.bind(runtime.services.tasks)
  runtime.services.tasks.send = async (id, messageId, text, attachmentIds) => {
    if (text === 'Native first') composerMessageAttempts.push(messageId)
    if (text === 'Native retry') {
      composerRetryAttempts.push(messageId)
      if (composerRetryAttempts.length === 1)
        throw new Error('Fixture interrupted reply. Retry this message.')
    }
    const result = await send(id, messageId, text, attachmentIds)
    if (text === 'Native first' && composerMessageAttempts.length === 1)
      throw new Error('Fixture delivered message had a lost reply.')
    return result
  }
}
try {
  if (settingsOnly) settingsProxy = await settingsSaveProxy(runtime.port)
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'Dovo Test'],
    ['config', 'user.email', 'test@example.invalid'],
  ])
    execFileSync('git', args, { cwd: directory })
  await writeFile(join(directory, '.git/info/exclude'), 'terminal-proof.txt\n', { flag: 'a' })
  await writeFile(join(directory, 'hello.txt'), 'original\n')
  execFileSync('git', ['add', '.'], { cwd: directory })
  execFileSync('git', ['commit', '-qm', 'Fixture'], { cwd: directory })
  await writeFile(join(directory, 'hello.txt'), 'mobile review\n')
  runtime.services.store.update((workspace) => ({
    ...workspace,
    agents: [
      {
        id: 'mobile-agent',
        name: 'Mobile agent',
        provider: 'codex',
        model: '',
        instructions: '',
        permission: 'ask',
        endpoint: '',
        ...(modesOnly ? { serviceTier: 'priority', cyberAccessProgram: 'daybreakBlue' } : {}),
      },
    ],
    repositories: [
      {
        id: 'mobile-repo',
        name: navigationOnly
          ? 'developer-platform/mobile-and-desktop-runtime-connections'
          : 'Mobile fixture',
        path: directory,
        branch: 'main',
      },
    ],
    tasks: [
      {
        id: 'mobile-task',
        title: navigationOnly
          ? 'Review remote runtime pairing across the mobile and desktop developer workspace'
          : 'Mobile verification',
        ...(navigationOnly
          ? { checkoutBranch: 'fix/restore-remote-runtime-connections-after-network-changes' }
          : {}),
        repositoryId: 'mobile-repo',
        agentId: 'mobile-agent',
        status: 'review',
        createdAt: new Date().toISOString(),
        messages: [
          { id: 'response', role: 'assistant', text: 'Review this change from your phone.' },
        ],
        files: [
          {
            path: 'hello.txt',
            before: 'original\n',
            after: 'mobile review\n',
            diskContents: 'mobile review\n',
            viewed: false,
          },
        ],
        draft: '',
        example: false,
      },
    ],
  }))
  runtime.services.commands.save({
    ...runtime.services.commands.get(),
    codex: resolve('scripts/fixtures/codex.cjs'),
  })
  if (modesOnly) {
    const patch = runtime.services.store.patch.bind(runtime.services.store)
    runtime.services.store.patch = (value) => {
      const result = patch(value)
      if (
        value.collection === 'tasks' &&
        value.id === 'mobile-task' &&
        value.changes.agentOverrides
      )
        modeSaves.push(structuredClone(runtime.services.store.task('mobile-task').agentOverrides))
      return result
    }
  }
  if (settingsOnly) {
    const patch = runtime.services.store.patch.bind(runtime.services.store)
    runtime.services.store.patch = (value) => {
      const result = patch(value)
      if (
        value.collection === 'tasks' &&
        value.id === 'mobile-task' &&
        value.changes.agentOverrides
      )
        settingsSaves.push(
          structuredClone(runtime.services.store.task('mobile-task').agentOverrides),
        )
      return result
    }
  }
  if (jobsOnly) {
    const startManual = runtime.services.jobs.startManual.bind(runtime.services.jobs)
    runtime.services.jobs.startManual = (id, requestId) => {
      jobStartIds.push(requestId)
      const result = startManual(id, requestId)
      if (jobStartIds.length === 1) throw new Error('Fixture run start reply was lost.')
      return result
    }
    const data = {
      label: 'Start',
      kind: 'trigger',
      trigger: 'manual',
      schedule: '0 9 * * 1-5',
      timezone: 'Europe/Amsterdam',
      objective: 'Preflight',
      agentId: 'mobile-agent',
      repositoryId: 'mobile-repo',
      execution: 'main',
    }
    const nodes = [
      { id: 'start', label: 'Start', kind: 'trigger' },
      { id: 'preflight', label: 'Preflight', kind: 'task' },
      { id: 'update', label: 'Update', kind: 'task' },
      { id: 'review', label: 'Review changes', kind: 'review' },
    ].map((step, index) => ({
      id: step.id,
      type: 'automation',
      position: { x: index * 320, y: 80 },
      data: { ...data, ...step, objective: step.label },
    }))
    runtime.services.store.update((workspace) => ({
      ...workspace,
      automations: [
        {
          id: 'jobs-fixture',
          name: 'Repository check',
          enabled: false,
          nodes,
          edges: nodes.slice(1).map((node, index) => ({
            id: `edge-${index}`,
            source: nodes[index].id,
            target: node.id,
          })),
        },
      ],
    }))
    runtime.services.agents.get = async () => ({
      probe: async () => ({ provider: 'codex', available: true, detail: 'Fixture' }),
      run: async (run) => {
        const step = run.prompt.includes('Preflight') ? 'preflight' : 'update'
        jobAttempts.push(step)
        if (step === 'update' && jobAttempts.filter((value) => value === step).length === 1)
          throw new Error('Fixture connection interrupted. Retry this step.')
        run.onText('Automation step verified.')
      },
    })
  }
  const code = runtime.services.pairing.createCode().code
  // Approve only this isolated fixture's explicitly named test device.
  approve = setInterval(() => {
    for (const terminal of runtime.services.terminals.list()) {
      if (runtime.services.terminals.get(terminal.id).listeners.size > 0) terminalConnected = true
    }
    for (const request of runtime.services.pairing.pending())
      if (request.name === 'Dovo simulator test') runtime.services.pairing.approve(request.id, true)
  }, 250)
  let flowPath = resolve(
    settingsOnly
      ? 'apps/mobile/maestro/settings-save.yaml'
      : modesOnly
        ? 'apps/mobile/maestro/codex-modes.yaml'
        : jobsOnly
          ? 'apps/mobile/maestro/jobs.yaml'
          : dictationOnly
            ? 'apps/mobile/maestro/dictation.yaml'
            : conversationOnly
              ? 'apps/mobile/maestro/conversation.yaml'
              : navigationOnly
                ? 'apps/mobile/maestro/navigation.yaml'
                : composerOnly
                  ? 'apps/mobile/maestro/composer.yaml'
                  : terminalOnly
                    ? 'apps/mobile/maestro/terminal.yaml'
                    : 'apps/mobile/maestro/workspace.yaml',
  )
  if (navigationOnly) {
    const hierarchy = JSON.parse(
      execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi'], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      }),
    )
    const bounds = hierarchy.children?.[0]?.attributes?.bounds?.match(
      /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/,
    )
    if (!bounds) throw new Error('Could not measure the simulator window for task layout checks')
    const halfWidth = Math.floor((Number(bounds[3]) - Number(bounds[1]) - 32) / 2)
    const flow = (await readFile(flowPath, 'utf8'))
      .replaceAll('${TASK_ROW_HALF_WIDTH}', String(halfWidth))
      .replaceAll(
        'reset-computers.yaml',
        JSON.stringify(resolve('apps/mobile/maestro/reset-computers.yaml')),
      )
    flowPath = join(directory, 'navigation.yaml')
    await writeFile(flowPath, flow)
  }
  // Native tab identifiers are not exposed by iOS 27; use the labeled native tab bar.
  // Keep nested flows beside the transformed entrypoint so their selectors agree.
  const fixtureFlows = join(directory, 'flows')
  await mkdir(fixtureFlows)
  const nativeTabSelectors = (flow) =>
    flow
      .replace(
        /^(\s*)id: Tab (.+)$/gm,
        (_match, indent, label) =>
          `${indent}text: ${label}\n${indent}childOf:\n${indent}  text: Tab Bar`,
      )
      .replaceAll(resolve('apps/mobile/maestro') + '/', fixtureFlows + '/')
  for (const name of await readdir('apps/mobile/maestro'))
    if (name.endsWith('.yaml'))
      await writeFile(
        join(fixtureFlows, name),
        nativeTabSelectors(await readFile(resolve('apps/mobile/maestro', name), 'utf8')),
      )
  const runFlow = async (path) => {
    const entrypoint = join(fixtureFlows, path.split('/').at(-1))
    await writeFile(entrypoint, nativeTabSelectors(await readFile(path, 'utf8')))
    const child = spawn(
      'maestro',
      [
        '--device',
        device,
        'test',
        '-e',
        `RUNTIME_ADDRESS=http://127.0.0.1:${settingsProxy?.port ?? runtime.port}`,
        '-e',
        `PAIRING_CODE=${code}`,
        entrypoint,
      ],
      { stdio: 'inherit' },
    )
    const codeResult = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    if (codeResult !== 0) {
      console.error(
        'Fixture question history:',
        runtime.services.activity.list('', 'question', 0).events,
      )
      throw new Error(`Mobile UI verification failed (${codeResult})`)
    }
  }
  if (composerOnly) {
    await runFlow(resolve('apps/mobile/maestro/composer-layout-empty.yaml'))
    await verifyComposerBounds(device, 'empty')
    await runFlow(resolve('apps/mobile/maestro/composer-layout-typed.yaml'))
    await verifyComposerBounds(device, 'typed')
  }
  await runFlow(flowPath)
  if (
    !composerOnly &&
    !navigationOnly &&
    !conversationOnly &&
    !dictationOnly &&
    !jobsOnly &&
    !modesOnly &&
    !settingsOnly
  ) {
    if ((await readFile(join(directory, 'terminal-proof.txt'), 'utf8')) !== 'mobile-terminal-ok')
      throw new Error(
        'Typing into the mobile terminal did not execute the command in the task checkout',
      )
    if (!terminalConnected) throw new Error('The mobile terminal never attached its WebSocket')
    if (runtime.services.terminals.list().length)
      throw new Error('Close shell did not terminate the session')
  }
  if (composerOnly) {
    const draft = runtime.services.store.get().tasks.find((entry) => entry.id !== 'mobile-task')
    if (!draft || draft.status !== 'draft' || draft.messages.length || draft.turns?.length)
      throw new Error('The new-draft keyboard layout check unexpectedly submitted a message')
    const draftManifest = JSON.parse(
      await readFile(
        join(
          appData,
          'Library',
          'Application Support',
          'com.dovo.studio',
          'RCTAsyncLocalStorage_V1',
          'manifest.json',
        ),
        'utf8',
      ),
    )
    if (
      !Object.entries(draftManifest).some(
        ([key, value]) =>
          key.startsWith('dovo.draft.') &&
          key.endsWith(`.${draft.id}`) &&
          value === 'Keyboard layout draft',
      )
    )
      throw new Error('The keyboard layout draft was not retained in native client storage')
    const task = runtime.services.store.task('mobile-task')
    if (
      composerMessageAttempts.length !== 1 ||
      composerRetryAttempts.length !== 2 ||
      new Set(composerRetryAttempts).size !== 1 ||
      task.messages.filter((message) => message.text === 'Native first').length !== 1
    )
      throw new Error('Reopening the thread lost retry identity or retried a confirmed message')
    if (task.turns?.[0]?.status !== 'cancelled' || task.queue?.length)
      throw new Error('Composer stop and queue changes were not retained')
  }
  if (navigationOnly) {
    const task = runtime.services.store.task('mobile-task')
    if (!task.pinned || task.archived || task.snoozedUntil)
      throw new Error('Native task menu pin, snooze/unsnooze and settle/reopen were not retained')
  }
  if (
    !terminalOnly &&
    !composerOnly &&
    !navigationOnly &&
    !conversationOnly &&
    !dictationOnly &&
    !jobsOnly &&
    !modesOnly &&
    !settingsOnly
  ) {
    const task = runtime.services.store.task('mobile-task')
    if (!task.pinned || task.turns?.[0]?.status !== 'cancelled' || task.queue?.length)
      throw new Error(
        `Native task state did not persist: ${JSON.stringify({ pinned: task.pinned, turns: task.turns, queue: task.queue })}`,
      )
    const questions = runtime.services.activity.list('', 'question', 0).events
    if (
      questions.length !== 1 ||
      !questions[0].payload.includes('Keep it compact') ||
      runtime.services.questions.list().length
    )
      throw new Error('Native question answers were not retained or the request is still pending')
    if ((await runtime.services.git.inspect(directory)).branch !== 'mobile-review')
      throw new Error('Native branch creation did not switch the project checkout')
    if (!task.messages.some((m) => m.attachments?.some((f) => f.name === 'dovo-attachment.txt')))
      throw new Error('Native attachment was not retained in chat')
    const submissions = runtime.services.activity.list('', 'submission', 0).events
    if (
      submissions.length !== 1 ||
      !submissions[0].payload.includes('Shortcut verification message')
    )
      throw new Error('Shortcut submission was not retained exactly once')
    const shortcutTasks = runtime.services.store
      .get()
      .tasks.filter((task) => task.title === 'Simplify task creation')
    if (
      shortcutTasks.length !== 1 ||
      shortcutTasks[0].messages[0]?.text !== 'Shortcut verification message'
    )
      throw new Error('Shortcut task did not retain its input')
  }
  if (conversationOnly) {
    const turn = runtime.services.store.task('mobile-task').turns?.at(-1)
    if (
      turn?.status !== 'completed' ||
      !turn.checkpoint?.files.some((file) => file.path === 'checkpoint-fixture.txt')
    )
      throw new Error('The conversation checkpoint was not retained by the runtime')
  }
  if (dictationOnly && runtime.services.store.task('mobile-task').messages.length !== 1)
    throw new Error('Dictation permission handling submitted a message')
  if (jobsOnly) {
    const snapshot = runtime.services.store.get()
    const runs = runtime.services.jobs.list()
    const run = runs.find((item) => item.automationId === 'jobs-fixture')
    if (
      runs.length !== 1 ||
      jobStartIds.length !== 2 ||
      !jobStartIds[0] ||
      new Set(jobStartIds).size !== 1 ||
      run?.status !== 'completed' ||
      run.taskIds.length !== 2 ||
      JSON.stringify(jobAttempts) !== JSON.stringify(['preflight', 'update', 'update'])
    )
      throw new Error(
        `Automation retry replayed work or did not finish: ${JSON.stringify({ jobStartIds, jobAttempts, runs })}`,
      )
    const created = snapshot.automations.find((flow) => flow.name === 'Mobile daily check updated')
    if (
      !created ||
      created.enabled ||
      !created.nodes.some(
        (node) =>
          node.data.kind === 'trigger' &&
          node.data.trigger === 'schedule' &&
          node.data.schedule === '0 9 * * 1-5',
      ) ||
      created.nodes.filter((node) => node.data.kind === 'task').length !== 1 ||
      created.nodes.filter((node) => node.data.kind === 'review').length !== 1 ||
      !created.nodes.some((node) => node.data.objective === 'Check the repository from my phone')
    )
      throw new Error(
        'Mobile automation creation/editing did not persist the configured steps safely',
      )
  }
  if (modesOnly) {
    const task = runtime.services.store.task('mobile-task')
    const base = runtime.services.store.get().agents[0]
    if (
      !modeSaves.some(
        (value) => value?.serviceTier === 'priority' && value.cyberAccessProgram === 'daybreakBlue',
      )
    )
      throw new Error('Native Fast and Daybreak Blue choices were not saved')
    if (
      !modeSaves.some(
        (value) => value?.serviceTier === 'default' && value.cyberAccessProgram === null,
      )
    )
      throw new Error('Native Standard and Automatic choices did not clear explicit modes')
    if (
      !modeSaves.some(
        (value) =>
          value?.model === 'gpt-daybreak-blue-latest' &&
          value.serviceTier === null &&
          value.cyberAccessProgram === null,
      )
    )
      throw new Error('Searching the long model catalog did not save the Daybreak Blue model')
    if (
      task.agentOverrides?.model !== '' ||
      task.agentOverrides?.serviceTier !== null ||
      task.agentOverrides?.cyberAccessProgram !== null
    )
      throw new Error(
        `Changing models did not retain explicit custom-agent clears: ${JSON.stringify(task.agentOverrides)}`,
      )
    if (
      base.serviceTier !== 'priority' ||
      base.cyberAccessProgram !== 'daybreakBlue' ||
      task.messages.length !== 1
    )
      throw new Error('Task mode changes modified the custom agent or submitted a message')
  }
  if (settingsOnly) {
    const task = runtime.services.store.task('mobile-task')
    const expected = {
      model: 'fixture/model',
      reasoning: 'high',
      permission: 'ask',
      serviceTier: 'priority',
      cyberAccessProgram: 'daybreakBlue',
    }
    if (
      !settingsProxy.released ||
      settingsProxy.attempts.length !== 2 ||
      JSON.stringify(settingsProxy.attempts[0]) !== JSON.stringify(settingsProxy.attempts[1])
    )
      throw new Error('The failing settings save was not retried with exactly the retained values')
    if (
      settingsSaves.length !== 1 ||
      JSON.stringify(settingsSaves[0]) !== JSON.stringify(expected) ||
      JSON.stringify(task.agentOverrides) !== JSON.stringify(expected)
    )
      throw new Error(
        `The model settings retry did not persist exactly once: ${JSON.stringify(settingsSaves)}`,
      )
    const agent = runtime.services.store.get().agents[0]
    if (
      task.agentId !== 'mobile-agent' ||
      task.harness ||
      task.messages.length !== 1 ||
      agent.model !== '' ||
      agent.reasoning ||
      agent.serviceTier ||
      agent.cyberAccessProgram
    )
      throw new Error('Saving task settings changed the base agent or submitted a message')
  }
  console.log(
    settingsOnly
      ? 'Native inline model settings guard Back, Close and edits during a pending save; visible failure retains values and retry persists exactly once.'
      : modesOnly
        ? 'Native Codex Fast, Daybreak Blue, inline long-catalog search, saved selections, Standard/Automatic resets and provider-default model capabilities verified.'
        : jobsOnly
          ? 'Native automation progress, failed-step retry without repeating completed work, review approval and mobile creation/editing verified.'
          : dictationOnly
            ? 'Native dictation permission errors preserve the draft and never submit a message.'
            : conversationOnly
              ? 'Native assistant-ui streaming, tool output and turn checkpoint navigation verified.'
              : navigationOnly
                ? 'Mobile native tabs, Projects, task details and cold Shortcut navigation verified.'
                : composerOnly
                  ? 'Mobile new-draft keyboard geometry, pane state, idempotent retry, attachments, queue, stop and keyboard verified.'
                  : terminalOnly
                    ? 'Mobile terminal keyboard, command execution and session lifecycle verified.'
                    : 'Mobile pairing, relaunch, native diff, terminal, queued follow-ups, agent questions, attachments, branch switching, task settings, cold Shortcut task and activity retention verified.',
  )
} finally {
  if (modesOnly) {
    if (previousLongCatalog === undefined) delete process.env.DOVO_FIXTURE_CODEX_LONG_CATALOG
    else process.env.DOVO_FIXTURE_CODEX_LONG_CATALOG = previousLongCatalog
  }
  if (dictationOnly)
    execFileSync('xcrun', ['simctl', 'privacy', device, 'reset', 'microphone', 'com.dovo.studio'])
  clearInterval(approve)
  await settingsProxy?.close()
  await runtime.close()
  await rm(directory, { recursive: true, force: true })
  await rm(join(appData, 'Documents', 'dovo-attachment.txt'), { force: true })
}

/** Measure stable native keyboard states between Maestro flows, without two UI drivers racing. */
async function verifyComposerBounds(device, stage) {
  const tree = JSON.parse(
    execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }),
  )
  const nodes = []
  const visit = (node) => {
    if (node.attributes) nodes.push(node.attributes)
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  const bounds = (label) => {
    const node = nodes.find(
      (attributes) =>
        attributes['resource-id'] === label ||
        attributes.accessibilityText === label ||
        attributes.text === label,
    )
    const values = node?.bounds
      ?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
      ?.slice(1)
      .map(Number)
    if (!values) throw new Error(`Missing composer control ${label} during ${stage} keyboard state`)
    const [left, top, right, bottom] = values
    return { label, left, top, right, bottom }
  }
  const toolbar = ['Attach files', 'Model & access', 'Dictate message', 'Send'].map(bounds)
  const checkout = bounds('Project & checkout')
  const dismiss = bounds('Dismiss keyboard')
  const input = bounds('Message')
  const navigation = ['Back', 'Chat', 'Terminal', 'Browser'].map(bounds)
  const controls = [...toolbar, checkout, dismiss]
  const center = (control) => (control.top + control.bottom) / 2
  for (const control of controls) {
    if (control.right - control.left < 43 || control.bottom - control.top < 43)
      throw new Error(
        `${control.label} lost its 44-point touch area with ${stage} keyboard: ${JSON.stringify(control)}`,
      )
  }
  if (toolbar.some((control) => Math.abs(center(control) - center(toolbar[0])) > 1))
    throw new Error(
      `Composer controls are not aligned with ${stage} keyboard: ${JSON.stringify(toolbar)}`,
    )
  // UIKit owns bar-item sizing and hit testing. Check their separation without imposing
  // custom-control dimensions; app-owned controls retain explicit 44-point targets.
  const allControls = [...controls, ...navigation]
  for (let i = 0; i < allControls.length; i++)
    for (let j = i + 1; j < allControls.length; j++) {
      const a = allControls[i],
        b = allControls[j]
      if (
        a.left < b.right - 1 &&
        b.left < a.right - 1 &&
        a.top < b.bottom - 1 &&
        b.top < a.bottom - 1
      )
        throw new Error(
          `Composer controls overlap with ${stage} keyboard: ${a.label} and ${b.label}`,
        )
    }
  if (input.right > dismiss.left + 1 || dismiss.bottom > toolbar[0].top + 1)
    throw new Error(
      `Dismiss keyboard has no reserved input-row space in ${stage}: ${JSON.stringify({ input, dismiss, toolbar })}`,
    )
  const artifactDirectory = resolve('work/verification')
  await mkdir(artifactDirectory, { recursive: true })
  await writeFile(
    join(artifactDirectory, `mobile-composer-keyboard-${stage}.json`),
    JSON.stringify({ stage, toolbar, checkout, dismiss, input, navigation, tree }, null, 2),
  )
}

/** Loopback-only fault injection for the native save lifecycle; production routes stay untouched. */
async function settingsSaveProxy(runtimePort) {
  const attempts = []
  let pending
  let deadline
  let released = false
  const reply = (response, status, value) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      if (request.method === 'POST' && request.url === '/__fixture/settings/reject') {
        if (!pending) return reply(response, 409, { released: false })
        clearTimeout(deadline)
        reply(pending, 503, { error: 'Fixture save failed. Your changes are still here.' })
        pending = undefined
        released = true
        return reply(response, 200, { released: true })
      }
      if (request.method === 'PATCH' && request.url === '/api/workspace') {
        const patch = JSON.parse(body.toString('utf8'))
        if (
          patch.collection === 'tasks' &&
          patch.id === 'mobile-task' &&
          patch.changes?.agentOverrides
        ) {
          attempts.push(patch)
          if (attempts.length === 1) {
            pending = response
            // Maestro releases the failure after its disabled-control assertions. This deadline
            // reports a stuck test before the mobile client's ordinary 30-second request timeout.
            deadline = setTimeout(() => {
              if (pending)
                reply(pending, 504, {
                  error: 'Fixture guard assertions did not release the save in time.',
                })
              pending = undefined
            }, 25000)
            return
          }
        }
      }
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port: runtimePort,
          path: request.url,
          method: request.method,
          headers: { ...request.headers, host: `127.0.0.1:${runtimePort}` },
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers)
          result.pipe(response)
        },
      )
      upstream.on('error', (error) => {
        if (!response.headersSent) reply(response, 502, { error: error.message })
        else response.destroy(error)
      })
      response.once('close', () => upstream.destroy())
      upstream.end(body)
    })().catch((error) => {
      if (!response.headersSent) reply(response, 500, { error: error.message })
      else response.destroy(error)
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    port: server.address().port,
    attempts,
    get released() {
      return released
    },
    close: async () => {
      clearTimeout(deadline)
      pending?.destroy()
      server.closeAllConnections()
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
