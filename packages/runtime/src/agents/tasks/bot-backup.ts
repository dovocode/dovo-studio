import { providerFailureKind } from '../execution/provider-failure.js'
import { isDeepStrictEqual } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import {
  decode,
  resolveTaskAgent,
  taskHarnessSchema,
  botPaused,
  type TaskHarness,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError, errorMessage } from '../../errors.js'
import { continueHarness } from './thread-handoff.js'

/** Compare provider/account choices without permission defaults or inherited resources. */
function target(agent: TaskHarness) {
  return {
    provider: agent.provider,
    model: agent.model,
    reasoning: agent.reasoning ?? '',
    endpoint: agent.executablePath || agent.endpoint,
    configDirectory: agent.configDirectory,
    acpInstallationId: agent.acpInstallationId,
    acpMode: agent.acpMode,
    acpConfig: agent.acpConfig ?? {},
    args: agent.args ?? [],
    env: agent.env ?? {},
    envSecrets: agent.envSecrets ?? {},
  }
}

/** Switch once, before acceptance. Never replay a turn that could have performed actions. */
export async function applyBotBackup(s: Services, id: string, turnId: string) {
  const task = s.store.task(id)
  const backup = s.store.get().agents.find((agent) => agent.id === task.bot?.backupAgentId)
  const current = resolveTaskAgent(task, s.store.get().agents)
  const turn = task.turns?.at(-1)
  if (
    !task.bot ||
    botPaused(task) ||
    task.pendingHarness ||
    !backup ||
    !current ||
    task.replica ||
    task.machineHandoff ||
    task.status !== 'failed' ||
    task.activeRunId ||
    turn?.id !== turnId ||
    turn.status !== 'failed' ||
    !task.runAttempt ||
    task.runAttempt.promptAccepted ||
    task.runPhase ||
    task.queue?.length ||
    task.subagentInbox?.length ||
    turn.checkpoint?.error ||
    task.draftTurnSettings ||
    !['capacity', 'quota', 'unavailable'].includes(providerFailureKind(task.error ?? ''))
  )
    return
  const revision = task.bot.revision
  const harness = decode(taskHarnessSchema, {
    ...backup,
    permission: current.permission,
    approvalPolicy: current.approvalPolicy,
    sandboxMode: current.sandboxMode,
    resources: current.resources,
    instructions: current.instructions,
    cloudIntegrations: current.cloudIntegrations,
  })
  if (isDeepStrictEqual(target(current), target(harness))) return
  const attemptKey = `bot-backup-attempt:${id}`
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        inputIds: task.runAttempt.inputMessageIds,
        backupId: backup.id,
        target: target(harness),
      }),
    )
    .digest('hex')
  if (
    s.db.prepare('SELECT value FROM documents WHERE id=?').pluck().get(attemptKey) === fingerprint
  )
    return
  // Consume before async handover. Failure, restart or changed defaults cannot loop this input.
  s.db
    .prepare('INSERT OR REPLACE INTO documents (id,value) VALUES (?,?)')
    .run(attemptKey, fingerprint)
  const requestId = randomUUID()
  try {
    await continueHarness(s, { id, requestId, stop: false, harness }, () => {
      const latest = s.store.task(id)
      if (
        latest.bot?.revision !== revision ||
        latest.status !== 'failed' ||
        latest.turns?.at(-1)?.id !== turnId ||
        latest.activeRunId ||
        !isDeepStrictEqual(resolveTaskAgent(latest, s.store.get().agents), current) ||
        !isDeepStrictEqual(
          s.store.get().agents.find((agent) => agent.id === backup.id),
          backup,
        )
      )
        throw new HttpError(
          409,
          'Bot changed while preparing its backup. The conversation is kept.',
        )
    })
    s.activity.add(
      'task',
      id,
      `Automatic backup: ${current.provider}/${current.model} → ${backup.provider}/${backup.model}. The original provider failed before accepting the request. Access settings were retained.`,
      { turnId },
    )
    // The failed request was not accepted. The normal bounded handover replays it.
    await s.tasks.start(id)
  } catch (error) {
    s.activity.add('task', id, `Automatic backup could not start: ${errorMessage(error)}`, {
      turnId,
    })
    const latest = s.store.taskSummary(id)
    if (
      latest.harnessHandoff?.id === requestId &&
      !latest.activeRunId &&
      latest.history.latestTurn?.id === turnId
    )
      s.store.updateTask(id, (currentTask) => ({
        ...currentTask,
        status: 'failed',
        queuePaused: true,
        error: `Automatic backup could not start. ${errorMessage(error)}`,
      }))
    throw error
  }
}
