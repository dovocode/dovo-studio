import { randomUUID, randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { mkdir, lstat } from 'node:fs/promises'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  transferEnvelopeSchema,
  transferPrepareSchema,
  transferReceiptSchema,
  transferPackageSchema,
  taskSchema,
  taskHarnessSchema,
  resolveTaskAgent,
  taskTransferBlocked,
  type TransferPrepare,
  type Task,
  type TransferPackage,
  type Artifact,
  artifactSchema,
  TRANSFER_MAX_BYTES,
  MAX_ATTACHMENT_BYTES,
  ARTIFACT_MAX_BYTES,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { attachmentFileName } from '../../storage/attachments.js'
import { HttpError } from '../../errors.js'
import { taskWorktreeKeys } from '../../scm/tasks/task-worktree-keys.js'
import {
  transferHash,
  exportNativeSession,
  importNativeSession,
  removeImportedSession,
} from './native-session.js'

const rowSchema = mutableStruct({ value: Schema.String })
const recordSchema = mutableStruct({
  id: Schema.String,
  direction: Schema.Literal('out', 'in'),
  state: Schema.Literal(
    'preparing',
    'prepared',
    'staging',
    'staged',
    'aborting',
    'sealed',
    'active',
    'aborted',
  ),
  request: Schema.optional(transferPrepareSchema),
  envelope: Schema.optional(transferEnvelopeSchema),
  receipt: Schema.optional(transferReceiptSchema),
  secret: Schema.optional(Schema.String),
  cancellationSecret: Schema.optional(Schema.String),
  directory: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  agentHash: Schema.optional(Schema.String),
  nativeFiles: Schema.optional(
    Schema.Array(mutableStruct({ path: Schema.String, hash: Schema.String })),
  ),
  nativeValidated: Schema.optional(Schema.Boolean),
  attachmentIds: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  artifactIds: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})
type Record = typeof recordSchema.Type
export const transferDocument = (id: string) => `task-transfer:${id}`
const digest = (value: unknown) => transferHash(JSON.stringify(value))
const origin = (address: string) => {
  const url = new URL(address)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.origin !== address
  )
    throw new HttpError(400, 'Use a paired runtime origin without credentials or a path')
  return url.origin
}

export class TaskTransfers {
  readonly runtimeId: string
  private pending = new Map<string, Promise<unknown>>()
  constructor(private s: Services) {
    const saved = this.readValue('task-transfer-runtime-id')
    this.runtimeId = saved ? decode(Schema.String, JSON.parse(saved)) : randomUUID()
    if (!saved) this.writeValue('task-transfer-runtime-id', JSON.stringify(this.runtimeId))
  }
  private readValue(id: string) {
    const row = this.s.db.prepare('SELECT value FROM documents WHERE id=?').get(id)
    return row ? decode(rowSchema, row).value : undefined
  }
  private writeValue(id: string, value: string) {
    this.s.db
      .prepare(
        'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(id, value)
  }
  private read(id: string) {
    const raw = this.readValue(transferDocument(id))
    return raw ? decode(recordSchema, JSON.parse(raw)) : undefined
  }
  private save(record: Record) {
    this.writeValue(transferDocument(record.id), JSON.stringify(record))
  }
  private serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(id) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    this.pending.set(id, result)
    void result
      .finally(() => {
        if (this.pending.get(id) === result) this.pending.delete(id)
      })
      .catch(() => {})
    return result
  }
  private change<T>(operation: () => T) {
    return this.s.store.transferMutation(() => this.s.store.transaction(operation))
  }
  async options() {
    const projects = []
    for (const repo of this.s.store.get().repositories) {
      if (repo.kind) continue
      const identity = await this.s.git.repositoryIdentity(repo.path, true)
      if (!identity) continue
      projects.push({
        id: repo.id,
        name: repo.name,
        identity,
        agents: this.s.store
          .agentsFor(repo.id)
          .map(({ id, name, provider, model }) => ({ id, name, provider, model })),
      })
    }
    return { runtimeId: this.runtimeId, projects }
  }
  private idle(taskId: string) {
    const s = this.s,
      task = s.store.task(taskId)
    s.tasks.requireIdle(taskId)
    s.jobs.requireTaskIdle(taskId)
    if (
      task.status === 'draft' ||
      !task.messages.length ||
      task.sideChats?.some((chat) => chat.messages.some((message) => message.status === 'pending'))
    )
      throw new HttpError(409, 'Start this task and finish pending side questions before moving')
    if (
      task.queue?.length ||
      task.runPhase ||
      task.activeRunId ||
      task.restartRecovery ||
      task.quotaContinuation ||
      task.scheduledMessages?.length ||
      task.startAfter
    )
      throw new HttpError(409, 'Finish or remove pending work before moving this task')
    if (
      task.linkedCheckouts?.length ||
      task.delegation ||
      s.store.get().tasks.some((item) => item.delegation?.parentTaskId === taskId)
    )
      throw new HttpError(409, 'Tasks with linked projects or child agents cannot move yet')
    if (task.pullRequest || task.workItem || task.archived || task.archivedAt || task.example)
      throw new HttpError(409, 'Choose an active, ordinary project task to move')
    if (
      s.terminals.list().some((item) => item.taskId === taskId && !item.exited) ||
      s.approvals.list().some((item) => item.taskId === taskId) ||
      s.questions.list().some((item) => item.taskId === taskId)
    )
      throw new HttpError(409, 'Close terminals and resolve pending interactions before moving')
    return task
  }
  private async clean(directory: string, head?: string) {
    if (
      (
        await this.s.git.command(directory, ['status', '--porcelain', '--untracked-files=all'])
      ).trim()
    )
      throw new HttpError(409, 'Commit or stash uncommitted changes before moving this task')
    const current = (await this.s.git.command(directory, ['rev-parse', 'HEAD'])).trim()
    if (head && current !== head)
      throw new HttpError(409, 'Checkout changed during transfer. Cancel the move and retry.')
    const special = (
      await this.s.git.command(directory, ['ls-files', '.gitmodules', '*.gitattributes'])
    ).trim()
    if (special.split('\n').some((path) => path === '.gitmodules'))
      throw new HttpError(409, 'Submodule projects cannot move yet')
    for (const path of special.split('\n').filter(Boolean)) {
      const content = await this.s.git.command(directory, ['show', `HEAD:${path}`])
      if (/filter\s*=\s*lfs/.test(content))
        throw new HttpError(409, 'Git LFS projects cannot move yet')
    }
    return current
  }
  prepare(input: TransferPrepare) {
    return this.serialize(input.id, async () => {
      const existing = this.read(input.id)
      if (existing) {
        if (existing.direction !== 'out' || digest(existing.request) !== digest(input))
          throw new HttpError(409, 'Transfer ID already has different contents')
        if (existing.state === 'aborted' || existing.state === 'aborting')
          throw new HttpError(
            409,
            'This transfer is cancelling or cancelled. Complete cancellation before starting a new move.',
          )
        if (existing.envelope) return existing.envelope
      }
      origin(input.sourceAddress)
      origin(input.target.address)
      if (input.target.runtimeId === this.runtimeId)
        throw new HttpError(400, 'Choose another computer')
      const task = this.idle(input.taskId)
      if (taskTransferBlocked(task) && task.transfer?.id !== input.id)
        throw new HttpError(409, 'Another move is pending')
      const repo = this.s.store.get().repositories.find((item) => item.id === task.repositoryId)
      if (!repo || repo.kind) throw new HttpError(409, 'Moving requires a Git project')
      const configured = resolveTaskAgent(task, this.s.store.get().agents)
      if (!configured) throw new HttpError(409, 'Choose an agent before moving')
      const directory = existing?.directory ?? (await this.s.checkouts.directory(task.id))
      return this.s.tasks.withCheckoutMutation(directory, async () => {
        this.idle(task.id)
        const record: Record = existing ?? {
          id: input.id,
          direction: 'out',
          state: 'preparing',
          request: input,
          directory,
          secret: randomBytes(32).toString('hex'),
          cancellationSecret: randomBytes(32).toString('hex'),
        }
        this.change(() => {
          this.save(record)
          this.s.store.updateTask(task.id, (value) => ({
            ...value,
            transfer: {
              id: input.id,
              direction: 'out',
              state: 'preparing',
              peerAddress: input.target.address,
              peerTaskId: input.target.taskId,
              mode: input.mode,
            },
          }))
        })
        const head = await this.clean(directory)
        const identity = await this.s.git.repositoryIdentity(directory, true)
        if (!identity)
          throw new HttpError(409, 'The project needs a Git remote to match it on another computer')
        const adapter = await this.s.agents.get(configured.provider)
        await adapter.closeTask?.(task.id)
        const native =
          input.mode === 'native'
            ? await exportNativeSession(this.s.agents.configure(configured), task.sessionId ?? '')
            : undefined
        const current = this.s.store.task(task.id)
        const attachmentIds = [
          ...new Set([
            ...current.messages.flatMap(
              (message) => message.attachments?.map((file) => file.id) ?? [],
            ),
            ...(current.draftAttachments?.map((file) => file.id) ?? []),
          ]),
        ]
        const artifacts: Artifact[] = []
        for (const item of this.s.artifacts.list(task.id))
          for (const revision of this.s.artifacts.versions(task.id, item.id))
            artifacts.push(this.s.artifacts.read(task.id, item.id, revision.revision))
        const snapshot: Task = {
          id: task.id,
          title: current.title,
          repositoryId: task.repositoryId,
          agentId: '',
          status: 'review',
          createdAt: task.createdAt,
          messages: current.messages,
          files: [],
          draft: current.draft,
          draftAttachments: current.draftAttachments,
          example: false,
          turns: current.turns?.map((turn) => ({ ...turn, checkpoint: undefined })),
          sessionId: native?.sessionId,
          consumedMessageIds: native ? current.consumedMessageIds : undefined,
          compactions: native ? current.compactions : undefined,
          sideChats: current.sideChats,
          budget: current.budget,
        }
        const value: TransferPackage = {
          version: 1,
          id: input.id,
          sourceRuntimeId: this.runtimeId,
          sourceAddress: input.sourceAddress,
          sourceDirectory: directory,
          target: input.target,
          mode: input.mode,
          identity,
          head,
          provider: configured.provider,
          model: configured.model,
          task: snapshot,
          attachments: attachmentIds.map((id) => this.s.attachments.read(task.id, id)),
          artifacts,
          native,
          activationHash: transferHash(record.secret!),
          cancellationHash: transferHash(record.cancellationSecret!),
        }
        const payload = decode(transferPackageSchema, value)
        if (Buffer.byteLength(JSON.stringify(payload)) > TRANSFER_MAX_BYTES - 4096)
          throw new HttpError(413, 'Task exceeds the 64 MB transfer limit')
        await this.clean(directory, head)
        const envelope = { package: payload, checksum: digest(payload) }
        this.change(() => {
          this.save({ ...record, state: 'prepared', envelope })
          this.s.store.updateTask(task.id, (value) => ({
            ...value,
            transfer: value.transfer && { ...value.transfer, state: 'prepared' },
          }))
        })
        return envelope
      })
    })
  }
  private destinationAgent(payload: TransferPackage) {
    const agent = this.s.store
      .agentsFor(payload.target.repositoryId)
      .find((item) => item.id === payload.target.agentId)
    if (!agent || agent.provider !== payload.provider || agent.model !== payload.model)
      throw new HttpError(
        409,
        'Choose an agent with the same provider and model on the destination',
      )
    return agent
  }
  private validateFiles(payload: TransferPackage) {
    const files = new Map<string, (typeof payload.attachments)[number]>()
    for (const file of payload.attachments) {
      const data = Buffer.from(file.data, 'base64')
      if (
        files.has(file.attachment.id) ||
        data.toString('base64') !== file.data ||
        data.length !== file.attachment.size ||
        data.length > MAX_ATTACHMENT_BYTES ||
        attachmentFileName(file.attachment.name) !== file.attachment.name
      )
        throw new HttpError(400, 'Invalid transferred attachment')
      files.set(file.attachment.id, file)
    }
    for (const file of [
      ...payload.task.messages.flatMap((message) => message.attachments ?? []),
      ...(payload.task.draftAttachments ?? []),
    ])
      if (digest(files.get(file.id)?.attachment) !== digest(file))
        throw new HttpError(400, 'Conversation attachment is missing or mismatched')
    const artifacts = new Set<string>()
    for (const artifact of payload.artifacts) {
      const key = `${artifact.id}:${artifact.revision}`
      if (
        artifacts.has(key) ||
        artifact.taskId !== payload.task.id ||
        Buffer.byteLength(artifact.content) > ARTIFACT_MAX_BYTES
      )
        throw new HttpError(400, 'Invalid transferred artifact')
      artifacts.add(key)
    }
    if (
      payload.mode === 'replay' &&
      (payload.native || payload.task.sessionId || payload.task.consumedMessageIds)
    )
      throw new HttpError(400, 'Replay must start a new provider session')
  }
  stage(envelope: typeof transferEnvelopeSchema.Type) {
    return this.serialize(envelope.package.id, async () => {
      const payload = envelope.package
      if (digest(payload) !== envelope.checksum)
        throw new HttpError(400, 'Task checksum does not match')
      if (payload.target.runtimeId !== this.runtimeId || payload.sourceRuntimeId === this.runtimeId)
        throw new HttpError(409, 'Package targets another runtime')
      origin(payload.sourceAddress)
      origin(payload.target.address)
      const previous = this.read(payload.id)
      if (previous?.state === 'aborted') throw new HttpError(409, 'This transfer was cancelled')
      if (
        previous &&
        (previous.direction !== 'in' || previous.envelope?.checksum !== envelope.checksum)
      )
        throw new HttpError(409, 'Transfer ID already has different contents')
      if (previous?.receipt) return previous.receipt
      this.validateFiles(payload)
      const repo = this.s.store
        .get()
        .repositories.find((item) => item.id === payload.target.repositoryId)
      if (
        !repo ||
        repo.kind ||
        (await this.s.git.repositoryIdentity(repo.path, true)) !== payload.identity
      )
        throw new HttpError(409, 'Choose the matching Git project on the destination')
      const agent = this.destinationAgent(payload)
      if (this.s.store.get().tasks.some((item) => item.id === payload.target.taskId))
        throw new HttpError(409, 'Destination task already exists')
      await this.s.git
        .command(repo.path, ['cat-file', '-e', `${payload.head}^{commit}`])
        .catch(() => {
          throw new HttpError(
            409,
            'Destination is missing the source commit. Fetch the project before moving.',
          )
        })
      const common = (
        await this.s.git.command(repo.path, [
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ])
      ).trim()
      const keys = taskWorktreeKeys(common, payload.target.taskId)
      const directory = join(keys.worktrees, keys.repositoryKey, `handoff-${keys.suffix}`)
      const branch = `dovo/handoff-${payload.target.taskId}`
      let record: Record = previous ?? {
        id: payload.id,
        direction: 'in',
        state: 'staging',
        envelope,
        directory,
        branch,
        agentHash: digest(agent),
        attachmentIds: Object.fromEntries(
          payload.attachments.map((file) => [file.attachment.id, randomUUID()]),
        ),
        artifactIds: Object.fromEntries(payload.artifacts.map((file) => [file.id, randomUUID()])),
      }
      if (!previous) {
        if (
          await lstat(directory).then(
            () => true,
            (error) => {
              if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
              throw error
            },
          )
        )
          throw new HttpError(409, 'Destination worktree path already exists')
        this.save(record)
      }
      const worktrees = (
        await this.s.git.command(repo.path, ['worktree', 'list', '--porcelain', '-z'])
      ).split('\0')
      if (!worktrees.includes(`worktree ${directory}`)) {
        await mkdir(dirname(directory), { recursive: true })
        const existingBranch = (
          await this.s.git.command(repo.path, [
            'for-each-ref',
            '--format=%(objectname)',
            `refs/heads/${branch}`,
          ])
        ).trim()
        if (existingBranch && existingBranch !== payload.head)
          throw new HttpError(409, 'Destination branch changed during transfer')
        await this.s.git.command(
          repo.path,
          existingBranch
            ? ['worktree', 'add', directory, branch]
            : ['worktree', 'add', '-b', branch, directory, payload.head],
        )
      }
      await this.clean(directory, payload.head)
      if (payload.mode === 'native' && !record.nativeValidated) {
        if (
          !payload.native ||
          payload.native.sessionId !== payload.task.sessionId ||
          payload.native.provider !== payload.provider
        )
          throw new HttpError(400, 'Native context is missing or mismatched')
        const nativeFiles = await importNativeSession(
          this.s.agents.configure(agent),
          payload.native,
          payload.sourceDirectory,
          directory,
          record.nativeFiles,
          (files) => {
            record = { ...record, nativeFiles: files }
            this.save(record)
          },
        )
        record = { ...record, nativeFiles, nativeValidated: true }
        this.save(record)
      }
      const receipt = { id: payload.id, checksum: envelope.checksum, taskId: payload.target.taskId }
      this.save({ ...record, state: 'staged', receipt })
      return receipt
    })
  }
  seal(receipt: typeof transferReceiptSchema.Type) {
    return this.serialize(receipt.id, async () => {
      const record = this.read(receipt.id),
        payload = record?.envelope?.package
      if (
        !record ||
        record.direction !== 'out' ||
        !payload ||
        record.envelope?.checksum !== receipt.checksum ||
        payload.target.taskId !== receipt.taskId ||
        !record.secret
      )
        throw new HttpError(409, 'Destination receipt does not match this move')
      if (!['prepared', 'sealed'].includes(record.state))
        throw new HttpError(409, 'This move is not ready to commit')
      if (record.state !== 'sealed') {
        this.idle(payload.task.id)
        await this.clean(record.directory!, payload.head)
        this.change(() => {
          this.save({ ...record, state: 'sealed', receipt })
          this.s.store.updateTask(payload.task.id, (task) => ({
            ...task,
            transfer: task.transfer && { ...task.transfer, state: 'sealed' },
          }))
        })
      }
      return { ...receipt, secret: record.secret }
    })
  }
  activate(proof: typeof transferReceiptSchema.Type & { secret: string }) {
    return this.serialize(proof.id, async () => {
      const previous = this.read(proof.id),
        payload = previous?.envelope?.package
      if (
        !previous ||
        previous.direction !== 'in' ||
        !payload ||
        previous.envelope?.checksum !== proof.checksum ||
        payload.target.taskId !== proof.taskId ||
        transferHash(proof.secret) !== payload.activationHash
      )
        throw new HttpError(409, 'Source activation proof does not match this move')
      let record: Record = previous
      if (record.state === 'active') return this.status(proof.id)
      if (record.state !== 'staged')
        throw new HttpError(409, 'Destination is not ready to activate')
      const agent = this.destinationAgent(payload)
      if (digest(agent) !== record.agentHash)
        throw new HttpError(
          409,
          'Destination agent settings changed. Restore them before completing the move.',
        )
      await this.clean(record.directory!, payload.head)
      if (payload.mode === 'native') {
        if (!payload.native) throw new HttpError(409, 'Native context is missing')
        const nativeFiles = await importNativeSession(
          this.s.agents.configure(agent),
          payload.native,
          payload.sourceDirectory,
          record.directory!,
          record.nativeFiles,
          (files) => {
            record = { ...record, nativeFiles: files }
            this.save(record)
          },
        )
        record = { ...record, nativeFiles }
        this.save(record)
      }
      this.validateFiles(payload)
      const attachment = (file: (typeof payload.attachments)[number]['attachment']) => ({
        ...file,
        id: record.attachmentIds?.[file.id] ?? file.id,
      })
      const defaults = this.s.store.taskDefaults(payload.target.repositoryId)
      const task: Task = decode(taskSchema, {
        ...defaults,
        ...payload.task,
        status: 'review',
        files: [],
        example: false,
        messages: payload.task.messages.map((message) => ({
          ...message,
          attachments: message.attachments?.map(attachment),
        })),
        draftAttachments: payload.task.draftAttachments?.map(attachment),
        turns: payload.task.turns?.map((turn) => ({ ...turn, checkpoint: undefined })),
        id: payload.target.taskId,
        repositoryId: payload.target.repositoryId,
        agentId: agent.id,
        agentName: agent.name,
        harness: decode(taskHarnessSchema, agent),
        execution: 'worktree',
        existingWorktreePath: record.directory,
        checkoutBranch: record.branch,
        checkoutLocked: true,
        providerLock: agent.provider,
        worktreeSetupComplete: false,
        transfer: {
          id: proof.id,
          direction: 'in',
          state: 'active',
          peerAddress: payload.sourceAddress,
          peerTaskId: payload.task.id,
          mode: payload.mode,
        },
      })
      if (payload.mode === 'native')
        task.importedSession = digest(resolveTaskAgent(task, this.s.store.get().agents))
      this.change(() => {
        for (const file of payload.attachments) {
          const data = Buffer.from(file.data, 'base64')
          if (data.toString('base64') !== file.data || data.length !== file.attachment.size)
            throw new HttpError(400, 'Invalid attachment bytes')
          const metadata = attachment(file.attachment)
          this.s.db
            .prepare('INSERT INTO attachments VALUES (?,?,?,?)')
            .run(metadata.id, task.id, JSON.stringify(metadata), data)
        }
        this.s.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, task] }))
        for (const entry of payload.artifacts) {
          const artifact = decode(artifactSchema, {
            ...entry,
            id: record.artifactIds?.[entry.id] ?? entry.id,
            taskId: task.id,
          })
          const { content: _content, ...metadata } = artifact
          this.s.db
            .prepare('INSERT INTO artifacts VALUES (?,?,?,?,?)')
            .run(
              artifact.id,
              task.id,
              artifact.revision,
              JSON.stringify(metadata),
              JSON.stringify(artifact),
            )
          this.s.activity.add(
            'tool',
            task.id,
            `Artifact · ${artifact.title}`,
            { status: 'completed', artifacts: [metadata] },
            `artifact:${artifact.id}:${artifact.revision}`,
          )
        }
        this.save({ ...record, state: 'active' })
      })
      return this.status(proof.id)
    })
  }
  status(id: string) {
    const record = this.read(id)
    if (!record) throw new HttpError(404, 'Transfer not found')
    return {
      id,
      state: record.state === 'staging' ? ('preparing' as const) : record.state,
      checksum: record.envelope?.checksum,
      taskId:
        record.direction === 'out'
          ? record.request!.taskId
          : (record.envelope?.package.target.taskId ?? id),
    }
  }
  request(id: string) {
    const record = this.read(id)
    if (!record?.request || record.direction !== 'out')
      throw new HttpError(404, 'Source transfer not found')
    return record.request
  }
  beginAbort(input: TransferPrepare) {
    const { id, taskId } = input
    return this.serialize(id, async () => {
      let record = this.read(id)
      if (!record) {
        const task = this.s.store.task(taskId)
        if (taskTransferBlocked(task)) throw new HttpError(409, 'Another move is pending')
        // Preparation may have failed before freezing. Still tombstone this attempt.
        record = {
          id,
          direction: 'out',
          state: 'aborting',
          request: input,
          cancellationSecret: randomBytes(32).toString('hex'),
        }
        this.save(record)
      }
      if (digest(record.request) !== digest(input))
        throw new HttpError(409, 'Cancellation targets another move')
      if (
        !record ||
        record.direction !== 'out' ||
        record.request?.taskId !== taskId ||
        !record.cancellationSecret
      )
        throw new HttpError(409, 'Source transfer not found')
      if (record.state === 'sealed')
        throw new HttpError(
          409,
          'Source committed the move. Retry completion instead of cancelling.',
        )
      if (record.state !== 'aborted')
        this.change(() => {
          this.save({ ...record, state: 'aborting' })
          if (this.s.store.task(taskId).transfer?.id === id)
            this.s.store.updateTask(taskId, (task) => ({
              ...task,
              transfer: task.transfer && { ...task.transfer, state: 'aborting' },
            }))
        })
      return {
        id,
        checksum: record.envelope?.checksum ?? digest(record.request),
        taskId: record.request.target.taskId,
        secret: record.cancellationSecret,
      }
    })
  }
  abort(proof: typeof transferReceiptSchema.Type & { secret: string }) {
    const { id } = proof
    return this.serialize(id, async () => {
      const record = this.read(id)
      if (record?.direction === 'out')
        throw new HttpError(409, 'Cancel the destination before unfreezing the source')
      if (record?.state === 'active')
        throw new HttpError(409, 'This task has moved. Move it back as a new transfer.')
      if (
        record?.envelope &&
        (record.envelope.checksum !== proof.checksum ||
          transferHash(proof.secret) !== record.envelope.package.cancellationHash)
      )
        throw new HttpError(409, 'Source cancellation proof does not match')
      // Tombstone even an upload that never reached this runtime; delayed stages cannot activate.
      this.save(
        record ? { ...record, state: 'aborted' } : { id, direction: 'in', state: 'aborted' },
      )
      if (record?.nativeFiles) await removeImportedSession(record.nativeFiles)
      // Retain the checkout as committed project data; cancellation never deletes user files.
      return {
        id,
        state: 'aborted' as const,
        taskId: record?.envelope?.package.target.taskId ?? id,
      }
    })
  }
  abortSource(id: string, taskId: string) {
    return this.serialize(id, async () => {
      const record = this.read(id)
      if (!record || record.direction !== 'out' || record.request?.taskId !== taskId)
        throw new HttpError(409, 'Source transfer not found')
      if (!['aborting', 'aborted'].includes(record.state))
        throw new HttpError(409, 'Cancel the destination before unfreezing this task.')
      this.change(() => {
        this.save({ ...record, state: 'aborted' })
        if (this.s.store.task(taskId).transfer?.id === id)
          this.s.store.updateTask(taskId, (task) => ({ ...task, transfer: undefined }))
      })
      return this.status(id)
    })
  }
}
const instances = new WeakMap<Services, TaskTransfers>()
export function taskTransfers(services: Services) {
  let transfers = instances.get(services)
  if (!transfers) {
    transfers = new TaskTransfers(services)
    instances.set(services, transfers)
  }
  return transfers
}
