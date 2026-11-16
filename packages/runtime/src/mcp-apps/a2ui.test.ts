import { afterEach, expect, it, vi } from 'vite-plus/test'
import { join } from 'node:path'
import { Schema } from 'effect'
import { decode } from '@dovo/protocol'
import { a2uiStateSchema } from '@dovo/protocol/a2ui'
import example from '../../../../examples/a2ui/issue-picker.json'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'
import { object } from './resources'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
async function setup(persistent = false) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = {
    databasePath: persistent ? join(f.directory, 'test.sqlite') : ':memory:',
    port: 0,
    ownerToken: 'a2ui-tests-owner-token-at-least-32-characters',
  }
  const runtime = await startRuntime(options)
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'A2UI',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Select issues',
  })
  const run = 'a2ui-test-run'
  s.store.updateTask(task.id, (task) => ({ ...task, activeRunId: run }))
  const command = (input: unknown = example) => s.mcpApps.a2uiCommand(task.id, run, input)
  const id = decode(Schema.Struct({ id: Schema.String }), command()).id
  const state = () =>
    a2uiStateSchema.parse(object(s.mcpApps.read(task.id, id).result).structuredContent)
  const action = (requestId: string, name: string, args: unknown = {}) =>
    s.mcpApps.action(task.id, id, requestId, 'tools/call', { name, arguments: args })
  const send = vi.fn<(taskId: string, messageId: string, text: string) => Promise<unknown>>(
    async () => ({}),
  )
  s.mcpApps.setSendMessage(send)
  const input = {
    revision: 1,
    draftVersion: 0,
    values: {
      issues: { '/selected': ['123'], '/instructions': 'Keep this input', '/includeTests': true },
    },
    surfaceId: 'issues',
    sourceComponentId: 'send',
  }
  return { f, s, task, run, runtime, options, id, state, action, command, send, input }
}

it('publishes one card per key, restores drafts and rejects stale updates', async () => {
  const { s, task, run, id, command, state, input } = await setup()
  expect(command()).toMatchObject({ id, revision: 1 })
  expect(command({ action: 'catalog' })).toHaveProperty('catalog')
  expect(s.mcpApps.read(task.id, id)).toMatchObject({ connected: true, format: 'apps' })
  await s.mcpApps.action(task.id, id, 'draft', 'ui/update-model-context', {
    structuredContent: { revision: 1, draftVersion: 0, values: input.values },
  })
  expect(state()).toMatchObject({ draftVersion: 1, values: input.values })
  const update = {
    action: 'publish',
    key: example.key,
    title: 'Updated issues',
    expectedRevision: 1,
    messages: [
      {
        version: '1.0',
        updateDataModel: { surfaceId: 'issues', path: '/instructions', value: 'Agent replacement' },
      },
    ],
  }
  expect(command(update)).toMatchObject({ id, revision: 2 })
  expect(state().values.issues['/instructions']).toBe('Keep this input')
  expect(command(update)).toMatchObject({ id, revision: 2 })
  expect(() => command({ ...update, title: 'Stale' })).toThrow('revision changed')
  expect(command({ ...update, expectedRevision: 2 })).toMatchObject({ id, revision: 3 })
  expect(state().values.issues['/instructions']).toBe('Keep this input')
  expect(() =>
    command({
      ...update,
      expectedRevision: 3,
      messages: [{ version: '1.0', deleteSurface: { surfaceId: 'issues' } }],
    }),
  ).toThrow('Unknown A2UI surface')
  expect(state().revision).toBe(3)
  expect(() =>
    s.mcpApps.a2uiCommand(task.id, 'wrong-run', { action: 'read', key: example.key }),
  ).toThrow('active')
  expect(() => s.mcpApps.read('other-thread', id)).toThrow(/not found/i)
  s.store.updateTask(task.id, (task) => ({ ...task, activeRunId: run }))
})

it('requires approval, resolves event context on the runtime and deduplicates submissions', async () => {
  const { s, action, send, input, state } = await setup()
  const response = action('submit', 'a2ui_submit', input)
  await waitForRuntime(() => expect(s.approvals.list()).toHaveLength(1))
  expect(send).not.toHaveBeenCalled()
  s.approvals.respond(s.approvals.list()[0].id, true)
  await response
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]).toEqual(
    expect.arrayContaining([
      expect.any(String),
      expect.any(String),
      expect.stringContaining('Keep this input'),
    ]),
  )
  expect(state()).toMatchObject({ submitted: true, delivery: 'sent' })
  await action('submit', 'a2ui_submit', input)
  expect(send).toHaveBeenCalledTimes(1)
  await expect(action('second-device', 'a2ui_submit', input)).rejects.toThrow('already recorded')
  await expect(action('forged', 'shell', { command: 'touch /tmp/forged' })).rejects.toThrow(
    'not available',
  )
})

it('preserves the draft after decline and rejects values or identity forged by a client', async () => {
  const { s, action, send, input, state } = await setup()
  vi.spyOn(s.approvals, 'request').mockResolvedValue('deny')
  await expect(action('decline', 'a2ui_submit', input)).rejects.toThrow('declined')
  expect(state().submitted).toBe(false)
  await expect(
    action('forged', 'a2ui_submit', { ...input, sourceComponentId: 'heading' }),
  ).rejects.toThrow('Unknown')
  await expect(
    action('invalid-option', 'a2ui_submit', {
      ...input,
      values: { issues: { '/selected': ['other'] } },
    }),
  ).rejects.toThrow('valid')
  await expect(
    action('extra', 'a2ui_submit', { ...input, context: { command: 'forged' } }),
  ).rejects.toThrow('Unrecognized key')
  expect(send).not.toHaveBeenCalled()
})

it('rejects draft conflicts and permission changes during approval', async () => {
  const { s, task, id, action, send, input } = await setup()
  const pending = action('approval', 'a2ui_submit', input)
  await waitForRuntime(() => expect(s.approvals.list()).toHaveLength(1))
  await s.mcpApps.action(task.id, id, 'other-device', 'ui/update-model-context', {
    structuredContent: { revision: 1, draftVersion: 0, values: input.values },
  })
  s.approvals.respond(s.approvals.list()[0].id, true)
  await expect(pending).rejects.toThrow('changed')
  await expect(
    s.mcpApps.action(task.id, id, 'stale-draft', 'ui/update-model-context', {
      structuredContent: { revision: 1, draftVersion: 0, values: input.values },
    }),
  ).rejects.toThrow('changed')
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
  }))
  await expect(action('read-only', 'a2ui_submit', { ...input, draftVersion: 1 })).rejects.toThrow(
    'editable',
  )
  expect(send).not.toHaveBeenCalled()
})

it('allows read-only publication and cancels pending responses when permission changes', async () => {
  const { s, task, id, action, command, send, input } = await setup()
  const pending = action('permission-change', 'a2ui_submit', input)
  const rejected = pending.catch((error: unknown) => error)
  await waitForRuntime(() => expect(s.approvals.list()).toHaveLength(1))
  s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
  }))
  expect(s.approvals.list()).toHaveLength(0)
  expect(await rejected).toMatchObject({ status: 403 })
  expect(send).not.toHaveBeenCalled()
  expect(command({ ...example, key: 'read-only-card', title: 'Read-only card' })).toMatchObject({
    revision: 1,
  })
  expect(object(s.mcpApps.read(task.id, id).result).structuredContent).toMatchObject({
    readOnly: true,
  })
})

it('restores saved cards and drafts after restart without replaying a response', async () => {
  const { s, task, id, input, runtime, options } = await setup(true)
  await s.mcpApps.action(task.id, id, 'saved-draft', 'ui/update-model-context', {
    structuredContent: { revision: 1, draftVersion: 0, values: input.values },
  })
  await runtime.close()
  cleanups.pop()
  const reopened = await startRuntime(options)
  cleanups.push(() => reopened.close())
  expect(reopened.services.mcpApps.read(task.id, id)).toMatchObject({ connected: true })
  const saved = a2uiStateSchema.parse(
    object(reopened.services.mcpApps.read(task.id, id).result).structuredContent,
  )
  expect(saved).toMatchObject({ submitted: false, draftVersion: 1, values: input.values })
})

it('allows only one concurrent submission and cancels pending approval on Stop', async () => {
  const { s, task, action, send, input, state } = await setup()
  const first = action('first-device', 'a2ui_submit', input)
  const second = action('second-device', 'a2ui_submit', input)
  const rejected = second.catch((error: unknown) => error)
  await waitForRuntime(() => expect(s.approvals.list()).toHaveLength(2))
  const approvals = s.approvals.list()
  s.approvals.respond(approvals[0].id, true)
  await first
  s.approvals.respond(approvals[1].id, true)
  expect(await rejected).toMatchObject({ status: 409 })
  expect(send).toHaveBeenCalledTimes(1)
  expect(state()).toMatchObject({ delivery: 'sent' })
  s.mcpApps.a2uiCommand(task.id, 'a2ui-test-run', {
    action: 'publish',
    key: example.key,
    title: example.title,
    expectedRevision: 1,
    messages: [
      {
        version: '1.0',
        updateDataModel: { surfaceId: 'issues', path: '/instructions', value: 'Next response' },
      },
    ],
  })
  const pending = action('cancelled', 'a2ui_submit', { ...input, revision: 2 })
  const cancelled = pending.catch((error: unknown) => error)
  await waitForRuntime(() => expect(s.approvals.list()).toHaveLength(1))
  s.mcpApps.cancelTask(task.id)
  expect(await cancelled).toMatchObject({ status: 403 })
  expect(send).toHaveBeenCalledTimes(1)
})

it('locks uncertain deliveries and never automatically repeats them', async () => {
  const { s, action, send, input, state } = await setup()
  vi.spyOn(s.approvals, 'request').mockResolvedValue('approve')
  send.mockRejectedValueOnce(new Error('Delivery acknowledgement was lost'))
  await expect(action('lost', 'a2ui_submit', input)).rejects.toThrow('acknowledgement')
  expect(state()).toMatchObject({ submitted: true, delivery: 'uncertain' })
  await expect(action('new-attempt', 'a2ui_submit', input)).rejects.toThrow('already recorded')
  expect(send).toHaveBeenCalledTimes(1)
})
