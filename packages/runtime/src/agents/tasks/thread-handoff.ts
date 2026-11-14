import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import {
  decode,
  resolveTaskAgent,
  portableThreadSchema,
  type PortableThread,
  type continueHarnessSchema,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { validateDefaultHarness } from '../../storage/runtime-defaults.js'

export function requireHandoffInputIdle(s: Services, id: string, queuedInput = false) {
  const task = s.store.taskSummary(id)
  if (!queuedInput && (task.queue?.length || task.subagentInbox?.length))
    throw new HttpError(409, 'Finish or remove queued input before continuing elsewhere.')
  if (task.draftTurnSettings)
    throw new HttpError(
      409,
      'Clear next-message overrides before continuing elsewhere. Your draft is saved.',
    )
  s.jobs.requireTaskIdle(id)
}

/** A handoff captures a closed execution boundary, never a live provider session. */
export async function withThreadCheckpoint<T>(
  s: Services,
  id: string,
  requestId: string,
  stop: boolean,
  action: (checkpoint: string | undefined, cwd: string) => Promise<T>,
  queuedInput = false,
) {
  const reservation = s.tasks.reserveDeletion([id])
  try {
    const task = s.store.taskSummary(id)
    if (queuedInput && !task.bot)
      throw new HttpError(409, 'Only a pending Bot change can keep queued input.')
    if (task.machineHandoff && task.machineHandoff.id !== requestId)
      throw new HttpError(409, 'Finish or cancel this thread’s existing transfer first.')
    if (task.delegation || task.sideThread || task.importedCodexSession || task.importedPiSession)
      throw new HttpError(
        409,
        'Imported sessions and child threads must stay with their original execution. Use a new independent thread.',
      )
    if (task.status === 'draft')
      throw new HttpError(
        409,
        'Choose the harness or computer in the draft settings before starting this thread.',
      )
    requireHandoffInputIdle(s, id, queuedInput)
    await s.tasks.stopForHandoff(id, stop, reservation)
    s.jobs.requireTaskIdle(id)
    if (s.terminals.list().some((terminal) => terminal.taskId === id && !terminal.exited))
      throw new HttpError(409, 'Close this thread’s terminals before continuing elsewhere.')
    const cwd = await s.checkouts.fileDirectory(id)
    return await s.tasks.withCheckoutMutation(cwd, async () => {
      s.tasks.requireIdle(id, reservation)
      requireHandoffInputIdle(s, id, queuedInput)
      const checkpoint = (await s.git.isRepository(cwd))
        ? await s.git.snapshot(cwd, `refs/dovo/handoffs/${requestId}`)
        : undefined
      requireHandoffInputIdle(s, id, queuedInput)
      return action(checkpoint, cwd)
    })
  } finally {
    s.tasks.releaseDeletion([id], reservation)
  }
}

export async function continueHarness(
  s: Services,
  input: typeof continueHarnessSchema.Type,
  guard?: () => void,
  queuedInput = false,
) {
  validateDefaultHarness(input.harness)
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const key = `harness-handoff:${input.requestId}`
  const receipt = () => {
    const row = s.db.prepare('SELECT value FROM documents WHERE id=?').get(key)
    if (!row) return false
    const saved = decode(portableReceiptSchema, row)
    if (saved.value !== fingerprint)
      throw new HttpError(409, 'This handoff ID belongs to another request.')
    return true
  }
  if (receipt()) return { ok: true as const }
  if (s.store.taskSummary(input.id).machineHandoff)
    throw new HttpError(
      409,
      'Finish or cancel this thread’s computer transfer before changing its harness.',
    )
  await withThreadCheckpoint(
    s,
    input.id,
    input.requestId,
    input.stop,
    async (checkpoint) => {
      if (receipt()) return
      guard?.()
      await s.tasks.releaseProviderForHandoff(input.id)
      requireHandoffInputIdle(s, input.id, queuedInput)
      guard?.()
      s.store.transaction(() => {
        s.store.updateTask(input.id, (task) => ({
          ...task,
          agentId: '',
          agentName: undefined,
          agentIcon: undefined,
          harness: input.harness,
          harnessCustomized: true,
          agentOverrides: undefined,
          modelSelection: undefined,
          modelSelectionDifficulty: undefined,
          providerLock: input.harness.provider,
          harnessHandoff: {
            id: input.requestId,
            provider: input.harness.provider,
            createdAt: new Date().toISOString(),
            checkpoint,
          },
          sessionId: undefined,
          sessionAgentId: undefined,
          contextUsage: undefined,
          subagents: undefined,
          consumedMessageIds: undefined,
          runAttempt: undefined,
          activeRunId: undefined,
          runPhase: undefined,
          restartRecovery: undefined,
          quotaContinuation: undefined,
          error: undefined,
          status: 'review',
        }))
        s.db.prepare('INSERT INTO documents (id,value) VALUES (?,?)').run(key, fingerprint)
      })
      s.activity.add(
        'task',
        input.id,
        `Continue with ${input.harness.provider} in a fresh session. Saved history and checklist retained.`,
      )
    },
    queuedInput,
  )
  return { ok: true as const }
}

const portableReceiptSchema = Schema.Struct({ value: Schema.String })

export function portableThread(s: Services, id: string): PortableThread {
  const task = s.store.task(id)
  const agent = resolveTaskAgent(task, s.store.get().agents)
  if (!agent) throw new HttpError(409, 'Choose a harness before moving this thread.')
  return decode(portableThreadSchema, {
    sourceRuntimeId: s.runtimeId,
    sourceTaskId: id,
    title: task.title,
    createdAt: task.createdAt,
    messages: task.messages.map((message) => ({ ...message, turnSettings: undefined })),
    // Checkpoint refs and provider retry/account identities belong to the source computer.
    turns: task.turns?.map(
      ({
        checkpoint: _checkpoint,
        providerRetry: _retry,
        usageAccount: _account,
        runId: _run,
        agentId: _agent,
        ...turn
      }) => ({ ...turn, agentId: '' }),
    ),
    nativeTodos: task.nativeTodos,
    draft: task.draft,
    draftAttachments: task.draftAttachments,
    draftPlan: task.draftPlan,
    provider: agent.provider,
    permission: agent.permission,
    approvalPolicy: agent.approvalPolicy,
    sandboxMode: agent.sandboxMode,
  })
}
