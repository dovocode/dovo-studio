import { decode, maxValue, minValue, strictStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError } from '../../errors.js'
import type { Services } from '../../services.js'
import { watchAccountRepositoryId, watchRepositoryError } from './watch-repository.js'

const identifier = maxValue(minValue(Schema.String, 1), 200)
const githubId = Schema.String.pipe(Schema.check(Schema.isPattern(/^[1-9]\d{0,15}$/)))
const inputSchema = strictStruct({
  taskId: identifier,
  parentRunId: identifier,
  repositoryId: Schema.optional(identifier),
  runId: githubId,
  jobId: Schema.optional(githubId),
  action: Schema.Literals(['failed-logs', 'retry-failed']),
})

export function agentPipeline(s: Services, raw: unknown, readOnly: boolean) {
  const { taskId, parentRunId, repositoryId, runId, jobId, action } = decode(inputSchema, raw)
  if (action === 'retry-failed' && (readOnly || jobId))
    throw new HttpError(403, 'Retry requires a writable thread and a run ID.')
  const task = s.store.taskSummary(taskId)
  const gitProjects = new Set(
    s.store
      .get()
      .repositories.filter((repo) => !repo.kind)
      .map((repo) => repo.id),
  )
  const project = repositoryId ?? watchAccountRepositoryId(task, gitProjects)
  const authorize = () => {
    s.tasks.assertToolScope(taskId, parentRunId)
    const accessError = watchRepositoryError(
      s.store.taskSummary(taskId),
      project,
      task.repositoryId,
    )
    if (accessError) throw new HttpError(403, accessError)
  }
  authorize()
  return s.forgeWork.agentPipeline(project, runId, action, jobId, authorize)
}
