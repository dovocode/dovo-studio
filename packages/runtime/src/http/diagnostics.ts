import { access, statfs } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { decode, mutableArray, mutableStruct, type RuntimeDiagnostics } from '@dovo/protocol'
import { Schema } from 'effect'
import type { Services } from '../services.js'

export async function runtimeDiagnostics(
  s: Services,
  now = Date.now(),
): Promise<RuntimeDiagnostics> {
  const warnings: string[] = []
  const storage: RuntimeDiagnostics['storage'] = { available: true, freeBytes: null, error: null }
  try {
    s.db.prepare('SELECT 1').get()
    if (s.db.name !== ':memory:') {
      await access(s.db.name, constants.R_OK | constants.W_OK)
      await access(dirname(resolve(s.db.name)), constants.W_OK)
      const info = await statfs(dirname(resolve(s.db.name)))
      storage.freeBytes = info.bavail * info.bsize
      if (storage.freeBytes < 16 * 1024 * 1024)
        warnings.push('Storage has less than 16 MB free; persistence may fail.')
    }
  } catch (error) {
    storage.available = false
    storage.error = error instanceof Error ? error.message : String(error)
    warnings.push('Runtime storage is unavailable.')
  }
  const schedulers = {
    tasks: s.tasks.schedulerStatus,
    jobs: s.jobs.schedulerStatus,
    errors: s.jobs.scheduleDiagnostics(),
  }
  for (const [name, status] of [
    ['Tasks', schedulers.tasks],
    ['Automations', schedulers.jobs],
  ] as const) {
    if (status.error) warnings.push(`${name} scheduler: ${status.error}`)
    if (!status.lastSuccess || now - Date.parse(status.lastSuccess) > 20_000)
      warnings.push(`${name} scheduler has not completed a tick within 20 seconds.`)
  }
  if (schedulers.errors.length)
    warnings.push(`${schedulers.errors.length} automation schedules need attention.`)
  const tasks = s.store.get().tasks
  const blockedQueues = tasks.filter((task) => task.queuePaused && task.queue?.length && task.error)
  if (blockedQueues.length)
    warnings.push(
      `${blockedQueues.length} queues are paused after an error. Review the affected tasks before resuming.`,
    )
  const questions = s.questions.list(),
    approvals = s.approvals.list()
  const actions = decode(
    mutableArray(
      mutableStruct({ taskId: Schema.String, kind: Schema.String, updatedAt: Schema.String }),
    ),
    s.db
      .prepare(
        "SELECT task_id AS taskId, kind, updated_at AS updatedAt FROM provider_actions WHERE state = 'uncertain' ORDER BY updated_at DESC LIMIT 200",
      )
      .all(),
  )
  const count = decode(
    mutableStruct({ count: Schema.Number }),
    s.db.prepare("SELECT COUNT(*) AS count FROM provider_actions WHERE state = 'uncertain'").get(),
  ).count
  if (count)
    warnings.push(
      `${count} provider operations have uncertain outcomes; they will not be replayed automatically.`,
    )
  let backups: RuntimeDiagnostics['backups']
  try {
    backups = await s.backups.status()
  } catch (error) {
    backups = {
      entries: [],
      active: false,
      maxCount: 5,
      maxBytes: 512 * 1024 * 1024,
      failure: {
        at: new Date(now).toISOString(),
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
  if (backups.failure) warnings.push(`Backup: ${backups.failure.message}`)
  return {
    ready: warnings.length === 0,
    checkedAt: new Date(now).toISOString(),
    warnings,
    roots: {
      database: s.db.name,
      worktrees: s.preferences.worktreesRoot(),
      worktreesSource: s.preferences.worktreesLocation().source,
    },
    storage,
    schedulers,
    queues: {
      queued: tasks.reduce((sum, task) => sum + (task.queue?.length ?? 0), 0),
      paused: tasks.filter((task) => task.queuePaused && task.queue?.length).length,
      waitingQuestions: questions.length,
      waitingApprovals: approvals.length,
    },
    operations: tasks
      .filter((task) => task.status === 'running')
      .map((task) => ({
        taskId: task.id,
        title: task.title,
        durationMs: Math.max(0, now - (Date.parse(task.turns?.at(-1)?.startedAt ?? '') || now)),
        state: questions.some((item) => item.taskId === task.id)
          ? 'Waiting for answer'
          : approvals.some((item) => item.taskId === task.id)
            ? 'Waiting for approval'
            : 'Running',
      })),
    uncertain: { count, actions },
    backups,
  }
}
