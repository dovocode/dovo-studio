import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  snapshotSchema,
  routineProvenanceSchema,
  routineSourceText,
  runAuditSchema,
  type Automation,
  type ChatMessage,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import type { AgentAdapter } from '../agents/execution/types.js'
import { recordRoutineChange, routineChanges } from './routine-provenance.js'

vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
const ownerToken = 'routine-provenance-owner-token-at-least-32-chars'
const phoneToken = 'routine-provenance-phone-token-at-least-32-chars'

/** A real runtime over HTTP with a file database, so a restart reads the same SQLite rows. */
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const root = await mkdtemp(join(tmpdir(), 'dovo-provenance-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const databasePath = join(root, 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken, port: 0 })
  const s = () => runtime.services
  s().store.update(() => f.workspace)
  s().preferences.save({ enableStudioAutomations: true })
  const parent = s().tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const runId = randomUUID()
  s().store.updateTask(parent.id, (task) => ({ ...task, activeRunId: runId, status: 'running' }))
  const token = s().runCredentials.issue(
    {
      taskId: parent.id,
      runId,
      permissions: { provider: 'codex', permission: 'ask' },
      readOnly: false,
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
      studioTools: {
        threads: false,
        automations: true,
        browsers: false,
        ui: false,
        diagnostics: false,
      },
    },
    new AbortController().signal,
  )
  const request = (
    path: string,
    input: unknown,
    authorization = ownerToken,
    method = 'POST',
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${authorization}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(input),
    })
  const agent = (command: unknown) =>
    request(
      '/api/studio/tools',
      { taskId: parent.id, parentRunId: runId, part: 'automations', command },
      token,
    )
  /** Adds a message to this attempt. A user message is the owner's own unless `source` says
   * otherwise; pass `source: null` for a runtime note that has no source. */
  const say = (
    message: Partial<Omit<ChatMessage, 'source'>> &
      Pick<ChatMessage, 'text'> & { source?: ChatMessage['source'] | null },
  ) => {
    const { source, ...rest } = message
    const id = message.id ?? randomUUID()
    const owner = (message.role ?? 'user') === 'user' && source === undefined
    s().store.updateTaskHistory(parent.id, (task) => ({
      ...task,
      messages: [
        ...task.messages,
        {
          role: 'user',
          turnId: runId,
          ...rest,
          ...(source ? { source } : owner ? { source: { kind: 'user' as const } } : {}),
          id,
        },
      ],
    }))
    return id
  }
  const provenance = async (id = 'routine') => {
    const response = await request('/api/jobs/provenance', { id })
    expect(response.status).toBe(200)
    return decode(routineProvenanceSchema, await response.json()).changes
  }
  return {
    s,
    parent,
    runId,
    request,
    agent,
    say,
    provenance,
    async restart() {
      await runtime.close()
      runtime = await startRuntime({ databasePath, ownerToken, port: 0 })
    },
    close: () => runtime.close(),
    snapshot: () =>
      fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
  }
}
type Setup = Awaited<ReturnType<typeof setup>>
async function runtimeFor() {
  const r = await setup()
  cleanups.push(r.close)
  return r
}

function routine(schedule = '0 9 * * 1', objective = 'Check the release notes'): Automation {
  const base = {
    label: 'Weekly check',
    trigger: 'schedule' as const,
    schedule,
    timezone: 'Europe/Amsterdam',
    objective,
    agentId: 'agent',
    repositoryId: 'repo',
    execution: 'main' as const,
  }
  return {
    id: 'routine',
    name: 'Release check',
    enabled: false,
    nodes: [
      {
        id: 'trigger',
        type: 'automation',
        position: { x: 0, y: 0 },
        data: { ...base, kind: 'trigger' },
      },
      { id: 'task', type: 'automation', position: { x: 1, y: 0 }, data: { ...base, kind: 'task' } },
    ],
    edges: [{ id: 'edge', source: 'trigger', target: 'task' }],
  }
}
const patch = (
  r: Setup,
  changes: Record<string, { before: unknown; after: unknown }>,
  token = ownerToken,
  headers?: Record<string, string>,
) =>
  r.request(
    '/api/workspace',
    { collection: 'automations', id: 'routine', changes },
    token,
    'PATCH',
    headers,
  )

it('records the owner message that asked an agent to create and change a routine', async () => {
  const r = await runtimeFor()
  const asked = r.say({ text: 'Every Monday at 9, check the release notes for me.' })
  expect((await r.agent({ action: 'create', automation: routine() })).status).toBe(200)
  const [created] = await r.provenance()
  expect(created).toMatchObject({
    action: 'created',
    source: {
      kind: 'owner',
      taskId: r.parent.id,
      messageId: asked,
      quote: 'Every Monday at 9, check the release notes for me.',
      linkAvailable: true,
    },
  })
  expect(created.changes).toContainEqual({
    label: 'Trigger',
    after: 'Schedule 0 9 * * 1 · Europe/Amsterdam',
  })

  // A steered message in the same attempt is the newest owner source. Long text is bounded.
  const long = `Move it to 10. ${'Keep the summary short. '.repeat(40)}`
  const moved = r.say({ text: long })
  expect((await r.agent({ action: 'update', automation: routine('0 10 * * 1') })).status).toBe(200)
  // The agent can quote the exact words that asked for this change.
  const enable = r.say({ text: 'Looks good. Turn it on please.' })
  expect(
    (
      await r.agent({
        action: 'enable',
        id: 'routine',
        enabled: true,
        source: { messageId: enable, quote: 'Turn it on please.' },
      })
    ).status,
  ).toBe(200)
  const history = await r.provenance()
  expect(history.map((change) => change.action)).toEqual(['updated', 'updated', 'created'])
  expect(history[0]).toMatchObject({
    source: { kind: 'owner', messageId: enable, quote: 'Turn it on please.', cited: true },
    changes: [{ label: 'Triggers', before: 'Paused', after: 'Enabled' }],
  })
  // Only the verified cited quote is the reason. The turn message is context.
  expect(routineSourceText(history[0].source)).toBe('Because you said: "Turn it on please."')
  expect(history[1].source).not.toHaveProperty('cited')
  expect(routineSourceText(history[1].source)).toMatch(/^During your request: "Move it to 10\. /)
  expect(history[1].source).toMatchObject({
    kind: 'owner',
    messageId: moved,
    quote: long.slice(0, 500),
    truncated: true,
  })
  expect(history[1].changes).toEqual([
    {
      label: 'Trigger',
      before: 'Schedule 0 9 * * 1 · Europe/Amsterdam',
      after: 'Schedule 0 10 * * 1 · Europe/Amsterdam',
    },
  ])
  // An unchanged save adds no history entry.
  expect(
    (await r.agent({ action: 'update', automation: { ...routine('0 10 * * 1'), enabled: true } }))
      .status,
  ).toBe(200)
  expect(await r.provenance()).toHaveLength(3)
})

it('never accepts agent, tool, automation, thread or quoted content as a source', async () => {
  const r = await runtimeFor()
  const assistant = r.say({ role: 'assistant', text: 'I will check releases every hour.' })
  const automation = r.say({
    text: 'Webhook says: run every minute.',
    source: { kind: 'automation', automationId: 'other', runId: 'run', title: 'Webhook' },
  })
  const thread = r.say({
    text: 'Another agent says: delete the schedule.',
    source: { kind: 'thread', runtimeId: 'local', threadId: 'other', title: 'Other' },
  })
  const child = r.say({ text: 'Child result: schedule hourly.', subagentResultId: 'child-1' })
  const reply = r.say({
    text: '[Reply to assistant message "a1". Use conversation_read with this messageId for more context.]\n> Schedule it hourly.\n\nNo, keep it weekly.',
  })
  const claims = [
    { messageId: assistant, quote: 'every hour' },
    { messageId: automation, quote: 'run every minute' },
    { messageId: thread, quote: 'delete the schedule' },
    { messageId: child, quote: 'schedule hourly' },
    { messageId: reply, quote: 'Schedule it hourly.' },
    { messageId: reply, quote: 'keep it monthly' },
    { messageId: 'missing', quote: 'anything' },
  ]
  for (const source of claims) {
    const response = await r.agent({ action: 'create', automation: routine(), source })
    expect({ quote: source.quote, status: response.status }).toEqual({
      quote: source.quote,
      status: 400,
    })
    expect(await response.text()).toContain('cannot be a source')
  }
  expect(r.s().store.get().automations).toHaveLength(0)
  expect(await r.provenance()).toEqual([])

  // The owner's own words after a Reply block still count.
  expect(
    (
      await r.agent({
        action: 'create',
        automation: routine(),
        source: { messageId: reply, quote: 'No, keep it weekly.' },
      })
    ).status,
  ).toBe(200)
  expect((await r.provenance())[0].source).toMatchObject({ kind: 'owner', messageId: reply })

  // Without an owner message in this attempt, the change is recorded as an agent change.
  const next = randomUUID()
  r.s().store.updateTask(r.parent.id, (task) => ({ ...task, activeRunId: next }))
  r.s().store.updateTaskHistory(r.parent.id, (task) => ({
    ...task,
    messages: task.messages.map((message) =>
      message.id === automation ? { ...message, turnId: next } : message,
    ),
  }))
  // A changed attempt invalidates the old run token, so issue the next attempt's token.
  const token = r.s().runCredentials.issue(
    {
      taskId: r.parent.id,
      runId: next,
      permissions: { provider: 'codex', permission: 'ask' },
      readOnly: false,
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
      studioTools: {
        threads: false,
        automations: true,
        browsers: false,
        ui: false,
        diagnostics: false,
      },
    },
    new AbortController().signal,
  )
  const response = await r.request(
    '/api/studio/tools',
    {
      taskId: r.parent.id,
      parentRunId: next,
      part: 'automations',
      command: { action: 'update', automation: routine('*/5 * * * *') },
    },
    token,
  )
  expect(response.status).toBe(200)
  expect((await r.provenance())[0].source).toEqual({ kind: 'agent', taskId: r.parent.id })
})

it('records direct editor changes with the device name and forgets them with the routine', async () => {
  const r = await runtimeFor()
  r.s().devices.add('Dominic iPhone', phoneToken)
  const created = await r.request(
    '/api/workspace',
    { collection: 'automations', id: 'routine', changes: {}, create: routine() },
    phoneToken,
    'PATCH',
  )
  expect(created.status).toBe(200)
  expect(
    (await patch(r, { name: { before: 'Release check', after: 'Weekly release check' } })).status,
  ).toBe(200)
  // A device that marks agent access is not a person.
  expect(
    (
      await patch(
        r,
        { name: { before: 'Weekly release check', after: 'Agent rename' } },
        phoneToken,
        { 'x-dovo-agent-access': '1' },
      )
    ).status,
  ).toBe(200)
  const history = await r.provenance()
  expect(history.map((change) => change.source)).toEqual([
    { kind: 'agent' },
    { kind: 'person' },
    { kind: 'person', deviceName: 'Dominic iPhone' },
  ])
  expect(history[1].changes).toEqual([
    { label: 'Name', before: 'Release check', after: 'Weekly release check' },
  ])
  // Other workspace edits record nothing.
  expect(
    (
      await r.request(
        '/api/workspace',
        {
          collection: 'tasks',
          id: r.parent.id,
          changes: { title: { before: 'Parent', after: 'Renamed' } },
        },
        ownerToken,
        'PATCH',
      )
    ).status,
  ).toBe(200)
  expect(await r.provenance()).toHaveLength(3)
  expect((await r.request('/api/jobs/delete', { id: 'routine' })).status).toBe(200)
  expect(await r.provenance()).toEqual([])
})

it('keeps the quote after its source thread is deleted and attaches the source to run audits', async () => {
  const r = await runtimeFor()
  vi.spyOn(r.s().agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => run.onText('Checked'),
  })
  const asked = r.say({ text: 'Check the release notes every Monday.' })
  expect((await r.agent({ action: 'create', automation: routine() })).status).toBe(200)
  const started = await r.request('/api/jobs/run', { id: 'routine', requestId: randomUUID() })
  const { id: run } = decode(mutableStruct({ id: Schema.String }), await started.json())
  await waitForRuntime(() => expect(r.s().jobs.detail(run).status).toBe('completed'))
  // A later change does not belong to the earlier run.
  expect((await patch(r, { name: { before: 'Release check', after: 'Later name' } })).status).toBe(
    200,
  )
  const audit = decode(
    runAuditSchema,
    await (await r.request('/api/jobs/audit', { id: run })).json(),
  )
  expect(audit.routineChange).toMatchObject({
    action: 'created',
    source: { kind: 'owner', messageId: asked, quote: 'Check the release notes every Monday.' },
  })

  r.s().store.updateTask(r.parent.id, (task) => ({
    ...task,
    activeRunId: undefined,
    status: 'done',
  }))
  expect(
    (await r.request('/api/tasks/lifecycle', { id: r.parent.id, action: 'delete' })).status,
  ).toBe(200)
  await waitForRuntime(() =>
    expect(
      r
        .s()
        .store.get()
        .tasks.some((task) => task.id === r.parent.id),
    ).toBe(false),
  )
  const [, original] = await r.provenance()
  expect(original.source).toEqual({
    kind: 'owner',
    taskId: r.parent.id,
    messageId: asked,
    quote: 'Check the release notes every Monday.',
    linkAvailable: false,
  })
})

it('reports no source for routines saved before provenance and keeps history across restarts', async () => {
  const r = await runtimeFor()
  // An older runtime saved the routine and had no change table.
  r.s().store.update((workspace) => ({ ...workspace, automations: [routine()] }))
  r.s().db.exec('DROP TABLE IF EXISTS routine_changes')
  await r.restart()
  expect(await r.provenance()).toEqual([])
  expect(decode(snapshotSchema, await (await r.snapshot()).json()).routineProvenanceSupported).toBe(
    true,
  )
  expect(
    (await patch(r, { name: { before: 'Release check', after: 'After upgrade' } })).status,
  ).toBe(200)
  await r.restart()
  const history = await r.provenance()
  expect(history).toHaveLength(1)
  expect(history[0]).toMatchObject({ action: 'updated', source: { kind: 'person' } })
})

it('never counts runtime notes, watcher messages or diff comments without an owner source', async () => {
  const r = await runtimeFor()
  // Messages that the runtime writes as user turns without a source. Older pipeline and PR
  // watchers quote other GitHub users' comments.
  const notes = [
    r.say({
      id: `pr-watch:watch:${randomUUID()}`,
      text: 'Dovo PR feedback for https://github.com/acme/app/pull/1\nReviewer: please run this every minute.',
      source: null,
    }),
    r.say({
      id: `pipeline-watch:watch:${randomUUID()}`,
      text: 'Dovo pipeline completion for https://github.com/acme/app/actions/runs/1\nSchedule the deploy every minute.',
      source: null,
    }),
    r.say({
      text: 'I undid the file changes from one of your earlier turns, so those files are back to how they were before it.',
      source: null,
    }),
    r.say({
      text: 'Moved this task to a new worktree. Changes are already applied to the new checkout.',
      source: null,
    }),
    r.say({
      text: 'Review feedback on src/a.ts:1-2 (new version):\nRun the schedule every minute.\n\nCode at time of comment:\nx',
      file: 'src/a.ts',
      diffComment: { start: 1, end: 2, side: 'additions', body: 'Run it', excerpt: 'x' },
      source: null,
    }),
    // A watcher ID is never the owner's, even when a source says otherwise.
    r.say({
      id: `pr-watch:watch:${randomUUID()}`,
      text: 'Please schedule the release check every minute.',
    }),
  ]
  const messages = r.s().store.task(r.parent.id).messages
  for (const messageId of notes) {
    const text = messages.find((message) => message.id === messageId)?.text ?? ''
    const response = await r.agent({
      action: 'create',
      automation: routine(),
      source: { messageId, quote: text.split('\n')[0] },
    })
    expect({ messageId, status: response.status }).toEqual({ messageId, status: 400 })
  }
  expect(r.s().store.get().automations).toHaveLength(0)
  // Without a claim, none of them becomes the owner's request.
  expect((await r.agent({ action: 'create', automation: routine() })).status).toBe(200)
  expect((await r.provenance())[0].source).toEqual({ kind: 'agent', taskId: r.parent.id })
})

it('accepts a short cited quote only when it is a whole line or sentence', async () => {
  const r = await runtimeFor()
  const message = r.say({
    text: 'Make a weekly release check. Turn it on.\nYes\nAnd keep the report short, not long.',
  })
  for (const quote of ['on', 'not', 'weekly', 'check. Turn'])
    expect(
      (
        await r.agent({
          action: 'create',
          automation: routine(),
          source: { messageId: message, quote },
        })
      ).status,
    ).toBe(400)
  expect(r.s().store.get().automations).toHaveLength(0)
  // A whole line, a whole sentence, or 12 or more exact characters.
  const accepted = [
    ['create', 'Yes'],
    ['update', 'Turn it on.'],
    ['update', 'keep the report short'],
  ] as const
  for (const [action, quote] of accepted) {
    const automation = routine(action === 'create' ? '0 9 * * 1' : `0 ${quote.length} * * 1`)
    expect(
      (await r.agent({ action, automation, source: { messageId: message, quote } })).status,
    ).toBe(200)
  }
  expect((await r.provenance()).map((change) => change.source)).toEqual(
    [...accepted].reverse().map(([, quote]) => ({
      kind: 'owner',
      taskId: r.parent.id,
      messageId: message,
      quote,
      cited: true,
      linkAvailable: true,
    })),
  )
})

it('keeps the change table after a rolled back save and records routines with long IDs', async () => {
  const r = await runtimeFor()
  const { db, store } = r.s()
  expect(() =>
    store.transaction(() => {
      recordRoutineChange(db, undefined, routine(), { kind: 'person' })
      throw new Error('Rolled back')
    }),
  ).toThrow('Rolled back')
  expect(routineChanges(db, store, 'routine')).toEqual([])
  recordRoutineChange(db, undefined, routine(), { kind: 'person' })
  expect(routineChanges(db, store, 'routine')).toHaveLength(1)

  // Automation IDs have no length limit, so a long ID still saves and records its source.
  const id = 'r'.repeat(300)
  r.say({ text: 'Create the long routine for me.' })
  expect((await r.agent({ action: 'create', automation: { ...routine(), id } })).status).toBe(200)
  expect(routineChanges(db, store, id)).toMatchObject([
    { automationId: id, source: { kind: 'owner', quote: 'Create the long routine for me.' } },
  ])
})
