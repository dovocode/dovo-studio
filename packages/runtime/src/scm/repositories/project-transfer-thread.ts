import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  decode,
  portableThreadSchema,
  resolveTaskDefaults,
  changeAgentProvider,
  permissionPolicyWithinCeiling,
  type ProjectTransferManifest,
  type PortableThread,
  type Attachment,
  type Repository,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { portableThread } from '../../agents/tasks/thread-handoff.js'
import { validateDefaultHarness } from '../../storage/runtime-defaults.js'

const MAX_THREAD_BYTES = 64 * 1024 * 1024
const attachments = (thread: PortableThread) => [
  ...new Map(
    [
      ...thread.messages.flatMap((message) => message.attachments ?? []),
      ...(thread.draftAttachments ?? []),
    ].map((file) => [file.id, file]),
  ).values(),
]

export async function prepareThreadTransfer(
  s: Services,
  id: string,
  folder: string,
  entries: ProjectTransferManifest['entries'],
) {
  const thread = portableThread(s, id)
  const add = async (kind: 'thread' | 'attachment', path: string, data: Buffer) => {
    await writeFile(join(folder, String(entries.length)), data, { mode: 0o600 })
    entries.push({
      kind,
      path,
      bytes: data.length,
      mode: 0o600,
      sha256: createHash('sha256').update(data).digest('hex'),
    })
  }
  const json = Buffer.from(JSON.stringify(thread))
  if (json.length > MAX_THREAD_BYTES)
    throw new HttpError(
      413,
      'The saved thread exceeds the 64 MB transfer limit. Its source is unchanged.',
    )
  await add('thread', 'thread.json', json)
  for (const file of attachments(thread)) {
    const saved = s.attachments.read(id, file.id)
    await add('attachment', file.id, Buffer.from(saved.data, 'base64'))
  }
}

export async function readThreadTransfer(manifest: ProjectTransferManifest, folder: string) {
  if (!manifest.handoff) return undefined
  const index = manifest.entries.findIndex((entry) => entry.kind === 'thread')
  if (index < 0 || manifest.entries[index].bytes > MAX_THREAD_BYTES)
    throw new HttpError(400, 'Missing or oversized thread history')
  const thread = decode(
    portableThreadSchema,
    JSON.parse(await readFile(join(folder, String(index)), 'utf8')),
  )
  if (
    thread.sourceRuntimeId !== manifest.handoff.sourceRuntimeId ||
    thread.sourceTaskId !== manifest.handoff.sourceTaskId
  )
    throw new HttpError(400, 'Thread history does not match this handoff')
  const expected = attachments(thread)
  const blobs = new Map<string, string>()
  const incoming = manifest.entries.filter((entry) => entry.kind === 'attachment')
  if (incoming.length !== expected.length)
    throw new HttpError(400, 'Thread attachments do not match this handoff')
  for (const file of expected) {
    const matches = manifest.entries.flatMap((entry, index) =>
      entry.kind === 'attachment' && entry.path === file.id ? [index] : [],
    )
    if (matches.length !== 1 || manifest.entries[matches[0]].bytes !== file.size)
      throw new HttpError(400, 'Missing or duplicate thread attachment')
    blobs.set(file.id, join(folder, String(matches[0])))
  }
  return { thread, blobs }
}

/** A hidden staged task uses the same durable execution fence as the moved source. */
export function receiveThreadTransfer(
  s: Services,
  manifest: ProjectTransferManifest,
  repository: Repository,
  payload: NonNullable<Awaited<ReturnType<typeof readThreadTransfer>>>,
  linked?: { path: string; branch?: string },
) {
  const { thread, blobs } = payload
  const defaults = resolveTaskDefaults(s.defaults.get(), repository)
  const policy = changeAgentProvider(
    {
      ...defaults.harness,
      provider: thread.provider,
      permission: thread.permission,
      approvalPolicy: thread.approvalPolicy,
      sandboxMode: thread.sandboxMode,
      id: '',
      name: '',
    },
    defaults.harness.provider,
  )
  const harness = {
    ...defaults.harness,
    permission: policy.permission,
    approvalPolicy: policy.approvalPolicy,
    sandboxMode: policy.sandboxMode,
  }
  validateDefaultHarness(harness)
  if (!permissionPolicyWithinCeiling(thread, harness))
    throw new HttpError(
      409,
      'The destination harness cannot preserve this thread’s permissions. Change the destination defaults and retry.',
    )
  const task = s.tasks.create({
    title: thread.title,
    repositoryId: repository.id,
    agentId: '',
    execution: linked ? 'worktree' : 'main',
    ...(linked ? { existingWorktreePath: linked.path, checkoutBranch: linked.branch } : {}),
    objective: '',
  })
  const files = new Map<string, Attachment>()
  for (const file of attachments(thread)) {
    const path = blobs.get(file.id)
    if (!path) throw new HttpError(400, 'Missing transferred attachment')
    files.set(file.id, s.attachments.receiveHandoff(task.id, file, readFileSync(path)))
  }
  const remap = (filesIn?: Attachment[]) =>
    filesIn?.map((file) => {
      const transferred = files.get(file.id)
      if (!transferred) throw new HttpError(400, 'Missing transferred attachment')
      return transferred
    })
  s.store.updateTaskHistory(task.id, (task) => ({
    ...task,
    title: thread.title,
    createdAt: thread.createdAt,
    harness,
    harnessCustomized: false,
    modelSelection: undefined,
    providerLock: harness.provider,
    checkoutLocked: true,
    harnessHandoff: {
      id: manifest.id,
      provider: harness.provider,
      createdAt: new Date().toISOString(),
    },
    machineHandoff: { id: manifest.id, state: 'staged', targetRuntimeId: s.runtimeId },
    origin: `handoff:${thread.sourceRuntimeId}:${thread.sourceTaskId}`,
    status: 'review',
    archivedAt: new Date().toISOString(),
    messages: thread.messages.map((message) => ({
      ...message,
      turnSettings: undefined,
      attachments: remap(message.attachments),
    })),
    turns: thread.turns?.map((turn) => ({
      ...turn,
      checkpoint: undefined,
      providerRetry: undefined,
      usageAccount: undefined,
      agentId: '',
    })),
    draft: thread.draft,
    draftPlan: thread.draftPlan,
    draftAttachments: remap(thread.draftAttachments),
    nativeTodos: thread.nativeTodos,
  }))
  return task.id
}
