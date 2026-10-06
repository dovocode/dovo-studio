import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeFile, unlink } from 'node:fs/promises'
import { Schema } from 'effect'
import {
  decode,
  moveTaskToComputer,
  abortTaskTransfer,
  taskTransferBlocked,
  type TransferPrepare,
} from '@dovo/protocol'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration } from '../../testing/integration'
import { exec } from '../../process'
import { startRuntime } from '../../index'
import type { AgentAdapter } from '../execution/types'
import { AgentRegistry } from '../configuration/registry'
import { TaskQueue } from '../tasks/task-queue'
import { TaskTransfers, taskTransfers, transferDocument } from './task-transfer'
import { transferHash } from './native-session'

vi.mock('../../scm/tasks/task-worktree-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../scm/tasks/task-worktree-keys')>()
  return {
    ...actual,
    taskWorktreeKeys: (common: string, id: string) => ({
      ...actual.taskWorktreeKeys(common, id),
      worktrees: join(common, 'test-transfer-worktrees'),
    }),
  }
})
vi.setConfig(runtimeIntegration)
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function setup(provider: 'codex' | 'claude' = 'codex') {
  const f = await fixture()
  cleanup.push(f.cleanup)
  f.workspace.agents[0].provider = provider
  const destination = join(f.directory, '.git', 'destination')
  await exec('git', ['remote', 'add', 'origin', 'https://github.com/example/handoff.git'], {
    cwd: f.directory,
  })
  await exec('git', ['clone', '-q', f.directory, destination])
  await exec('git', ['remote', 'set-url', 'origin', 'https://github.com/example/handoff.git'], {
    cwd: destination,
  })
  const ownerToken = 'handoff-test-owner-token'
  const source = await startRuntime({
    databasePath: join(f.directory, '.git', 'source.sqlite'),
    ownerToken,
    port: 0,
  })
  cleanup.push(source.close)
  const target = await startRuntime({
    databasePath: join(destination, '.git', 'destination.sqlite'),
    ownerToken,
    port: 0,
  })
  cleanup.push(target.close)
  source.services.store.update(() => f.workspace)
  target.services.store.update(() => ({
    ...f.workspace,
    repositories: [{ ...f.workspace.repositories[0], path: destination }],
  }))
  const getAdapter = vi.spyOn(AgentRegistry.prototype, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: vi.fn<AgentAdapter['run']>(),
    closeTask: vi.fn<NonNullable<AgentAdapter['closeTask']>>(),
  })
  const task = source.services.tasks.create({
    title: 'Move me',
    repositoryId: 'repo',
    agentId: 'agent',
    execution: 'main',
    objective: 'Keep the context',
  })
  source.services.store.updateTask(task.id, (task) => ({
    ...task,
    status: 'review',
    messages: [
      ...task.messages,
      { id: randomUUID(), role: 'assistant', text: 'Remember the decision: use HTTP.' },
    ],
  }))
  const transfers = taskTransfers(source.services),
    imports = taskTransfers(target.services)
  const input: TransferPrepare = {
    id: randomUUID(),
    taskId: task.id,
    sourceAddress: `http://127.0.0.1:${source.port}`,
    target: {
      runtimeId: imports.runtimeId,
      address: `http://127.0.0.1:${target.port}`,
      repositoryId: 'repo',
      agentId: 'agent',
      taskId: randomUUID(),
    },
    mode: 'replay',
  }
  const deviceTokens = new Map<string, string>()
  for (const [runtime, address] of [
    [source, input.sourceAddress],
    [target, input.target.address],
  ] as const) {
    const code = runtime.services.pairing.createCode(true)
    const request = runtime.services.pairing.request(code.code, 'Handoff client', '127.0.0.1')
    const claimed = runtime.services.pairing.claim(request.id, request.secret)
    if (!claimed.token) throw new Error('Test device pairing failed')
    expect(runtime.services.devices.authenticate(claimed.token).owner).toBe(false)
    deviceTokens.set(address, claimed.token)
  }
  const call =
    (address: string) =>
    async <S extends Schema.Schema.AnyNoContext>(path: string, value: unknown, schema: S) => {
      const result = await fetch(address + path, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deviceTokens.get(address)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(value),
      })
      const data: unknown = await result.json()
      if (!result.ok) throw new Error(JSON.stringify(data))
      return decode(schema, data)
    }
  return { f, source, target, transfers, imports, input, call, getAdapter }
}
it('moves over authenticated HTTP exactly once and imports independent attachments and artifact revisions', async () => {
  const s = await setup(),
    id = s.input.taskId
  const attachment = await s.source.services.attachments.upload({
    taskId: id,
    id: randomUUID(),
    name: 'context.txt',
    data: Buffer.from('context').toString('base64'),
  })
  s.source.services.preferences.save({ enableArtifacts: true })
  const artifact = s.source.services.artifacts.write({
    taskId: id,
    title: 'Decision',
    format: 'markdown',
    content: 'Use HTTP.',
  })
  s.source.services.artifacts.write({
    taskId: id,
    id: artifact.id,
    expectedRevision: 1,
    title: 'Decision',
    format: 'markdown',
    content: 'Use paired HTTP.',
  })
  const unauthorized = await fetch(s.input.sourceAddress + '/api/tasks/transfer/options', {
    method: 'POST',
  })
  expect(unauthorized.status).toBe(401)
  const envelope = await s.transfers.prepare(s.input)
  expect(taskTransferBlocked(s.source.services.store.task(id))).toBe(true)
  expect(() =>
    s.source.services.store.updateTask(id, (task) => ({ ...task, draft: 'edit' })),
  ).toThrow('move')
  expect(() => new TaskQueue(s.source.services.store).add(id, randomUUID(), 'run')).toThrow('move')
  const receipt = await s.imports.stage(envelope)
  expect(s.target.services.store.get().tasks).toHaveLength(0)
  // Recreate managers from persisted records to exercise lost responses and runtime restarts.
  const restoredSource = new TaskTransfers(s.source.services),
    restoredTarget = new TaskTransfers(s.target.services)
  expect(await restoredSource.prepare(s.input)).toEqual(envelope)
  expect(await restoredTarget.stage(envelope)).toEqual(receipt)
  const proof = await restoredSource.seal(receipt)
  expect(s.source.services.store.task(id).transfer?.state).toBe('sealed')
  await expect(restoredSource.beginAbort(s.input)).rejects.toThrow('committed')
  const activated = await restoredTarget.activate(proof)
  expect(activated.state).toBe('active')
  const imported = s.target.services.store.task(receipt.taskId)
  expect(imported.messages).toEqual(envelope.package.task.messages)
  expect(imported.sessionId).toBeUndefined()
  expect(imported.draftAttachments?.[0].id).not.toBe(attachment.attachment.id)
  expect(
    s.target.services.attachments.read(imported.id, imported.draftAttachments![0].id).data,
  ).toBe(Buffer.from('context').toString('base64'))
  const files = s.target.services.artifacts.list(imported.id)
  expect(files[0].id).not.toBe(artifact.id)
  expect(s.target.services.artifacts.versions(imported.id, files[0].id)).toHaveLength(2)
  expect(s.target.services.artifacts.read(imported.id, files[0].id).content).toBe(
    'Use paired HTTP.',
  )
  expect(
    (
      await s.target.services.git.command(imported.existingWorktreePath!, ['rev-parse', 'HEAD'])
    ).trim(),
  ).toBe(envelope.package.head)
  await moveTaskToComputer(s.call(s.input.sourceAddress), s.call(s.input.target.address), s.input)
  expect(s.target.services.store.get().tasks).toHaveLength(1)
  expect(taskTransferBlocked(s.source.services.store.task(id))).toBe(true)
  expect(taskTransferBlocked(imported)).toBe(false)
  // A return trip must not collide with the historical source records.
  const back: TransferPrepare = {
    ...s.input,
    id: randomUUID(),
    taskId: imported.id,
    sourceAddress: s.input.target.address,
    target: {
      ...s.input.target,
      runtimeId: s.transfers.runtimeId,
      address: s.input.sourceAddress,
      taskId: randomUUID(),
    },
  }
  await moveTaskToComputer(s.call(back.sourceAddress), s.call(back.target.address), back)
  expect(s.source.services.artifacts.list(back.target.taskId)[0].id).not.toBe(artifact.id)
})
it('cancels durably before sealing and rejects delayed uploads without freezing another attempt', async () => {
  const s = await setup()
  const envelope = await s.transfers.prepare(s.input)
  await s.imports.stage(envelope)
  await abortTaskTransfer(s.call(s.input.sourceAddress), s.call(s.input.target.address), s.input)
  expect(taskTransferBlocked(s.source.services.store.task(s.input.taskId))).toBe(false)
  await expect(s.imports.stage(envelope)).rejects.toThrow('cancelled')
  await expect(
    s.transfers.seal({
      id: s.input.id,
      checksum: envelope.checksum,
      taskId: s.input.target.taskId,
    }),
  ).rejects.toThrow('ready')
  expect(s.target.services.store.get().tasks).toHaveLength(0)
  const unprepared = {
    ...s.input,
    id: randomUUID(),
    target: { ...s.input.target, taskId: randomUUID() },
  }
  await abortTaskTransfer(s.call(s.input.sourceAddress), s.call(s.input.target.address), unprepared)
  expect(s.imports.status(unprepared.id).state).toBe('aborted')
  const next = { ...s.input, id: randomUUID(), target: { ...s.input.target, taskId: randomUUID() } }
  await s.transfers.prepare(next)
  await s.transfers.abortSource(s.input.id, s.input.taskId)
  expect(s.source.services.store.task(s.input.taskId).transfer?.id).toBe(next.id)
})
it('checks bytes before issuing a receipt and prevents sealing a changed source checkout', async () => {
  const s = await setup()
  await s.source.services.attachments.upload({
    taskId: s.input.taskId,
    id: randomUUID(),
    name: 'context.txt',
    data: Buffer.from('abc').toString('base64'),
  })
  const envelope = await s.transfers.prepare(s.input)
  const invalid = structuredClone(envelope)
  invalid.package.attachments[0].data = 'ZGVmZw=='
  invalid.checksum = transferHash(JSON.stringify(invalid.package))
  await expect(s.imports.stage(invalid)).rejects.toThrow('attachment')
  expect(s.target.services.store.get().tasks).toHaveLength(0)
  const receipt = await s.imports.stage(envelope)
  await writeFile(join(s.f.directory, 'hello.txt'), 'changed\n')
  await expect(s.transfers.seal(receipt)).rejects.toThrow('uncommitted')
  expect(s.source.services.store.task(s.input.taskId).transfer?.state).toBe('prepared')
  const cancellation = await s.transfers.beginAbort(s.input)
  await expect(s.transfers.seal(receipt)).rejects.toThrow('ready')
  await s.imports.abort(cancellation)
  await s.transfers.abortSource(s.input.id, s.input.taskId)
  expect(taskTransferBlocked(s.source.services.store.task(s.input.taskId))).toBe(false)
})
it('binds an imported native session to the destination runner without replaying old messages', async () => {
  const s = await setup('claude'),
    sessionId = randomUUID()
  const sourceHome = join(s.f.directory, '.git', 'claude-source'),
    targetHome = join(s.f.directory, '.git', 'claude-target')
  for (const [runtime, root] of [
    [s.source, sourceHome],
    [s.target, targetHome],
  ] as const)
    runtime.services.store.update((workspace) => ({
      ...workspace,
      agents: workspace.agents.map((agent) => ({
        ...agent,
        provider: 'claude',
        endpoint: process.execPath,
        env: { CLAUDE_CONFIG_DIR: root },
      })),
    }))
  const transcript = join(
    sourceHome,
    'projects',
    s.f.directory.replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  )
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(transcript, '..'), { recursive: true })
  const first = randomUUID()
  await writeFile(
    transcript,
    [
      {
        type: 'user',
        uuid: first,
        parentUuid: null,
        sessionId,
        cwd: s.f.directory,
        message: { role: 'user', content: 'Original context' },
      },
      {
        type: 'assistant',
        uuid: randomUUID(),
        parentUuid: first,
        sessionId,
        cwd: s.f.directory,
        message: { role: 'assistant', content: [{ type: 'text', text: 'Preserved context' }] },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join('\n') + '\n',
  )
  s.source.services.store.updateTask(s.input.taskId, (task) => ({
    ...task,
    sessionId,
    consumedMessageIds: task.messages.map((message) => message.id),
  }))
  const input = { ...s.input, mode: 'native' as const }
  const envelope = await s.transfers.prepare(input)
  await s.imports.stage(envelope)
  // Activation must restore an owned file lost between staging and source sealing.
  const { mutableStruct } = await import('@dovo/protocol')
  const row = decode(
    mutableStruct({ value: Schema.String }),
    s.target.services.db
      .prepare('SELECT value FROM documents WHERE id=?')
      .get(transferDocument(input.id)),
  )
  const staged = decode(
    mutableStruct({
      nativeFiles: Schema.Array(mutableStruct({ path: Schema.String, hash: Schema.String })),
    }),
    JSON.parse(row.value),
  )
  await unlink(staged.nativeFiles[0].path)
  await moveTaskToComputer(s.call(input.sourceAddress), s.call(input.target.address), input)
  expect(s.target.services.store.task(input.target.taskId).importedSession).toBeTruthy()
  const { Effect } = await import('effect')
  const { waitForRuntime } = await import('../../testing/integration')
  const run = vi.fn<import('../execution/types').AgentAdapter['run']>(async (context) => {
    expect(context.sessionId).toBe(sessionId)
    expect(context.prompt).toContain('Continue on this computer')
    expect(context.prompt).not.toContain('Remember the decision')
    expect(context.prompt).toContain('historical absolute paths')
    context.onSession(sessionId)
    context.onText('Continued with native context')
  })
  const adapter = { probe: vi.fn<AgentAdapter['probe']>(), run }
  s.getAdapter.mockResolvedValue(adapter)
  vi.spyOn(AgentRegistry.prototype, 'getEffect').mockReturnValue(Effect.succeed(adapter))
  await s.target.services.tasks.send(input.target.taskId, randomUUID(), 'Continue on this computer')
  await waitForRuntime(() => {
    const task = s.target.services.store.task(input.target.taskId)
    if (task.error) throw new Error(task.error)
    expect(task.messages.at(-1)?.text).toBe('Continued with native context')
  })
  expect(run).toHaveBeenCalledOnce()
  expect(s.target.services.store.task(input.target.taskId).importedSession).toBeUndefined()
})
