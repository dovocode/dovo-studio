import { Schema } from 'effect'
import { mutableStruct } from '../shared/schema.js'
import { responses } from '../runtime/connection/runtime.js'
import type { Task } from '../workspace.js'
import type { RuntimeProfile } from '../runtime/connection/runtime-fleet.js'
export type LauncherRequest = <T extends Schema.Schema.AnyNoContext>(
  profile: RuntimeProfile,
  path: string,
  input: unknown,
  schema: T,
  method?: 'GET' | 'POST' | 'PATCH',
) => Promise<Schema.Schema.Type<T>>
export type LauncherAttempt = {
  task: Task
  profile: RuntimeProfile
  messageId: string
  text: string
  created: boolean
}
/** Retain the creation and submission IDs across failures, including lost acknowledgements. */
export async function dispatchLauncherTask(attempt: LauncherAttempt, request: LauncherRequest) {
  if (!attempt.created) {
    await request(
      attempt.profile,
      '/api/workspace',
      { collection: 'tasks', id: attempt.task.id, create: attempt.task, changes: {} },
      mutableStruct({ revision: Schema.Number }),
      'PATCH',
    )
    attempt.created = true
  }
  await request(
    attempt.profile,
    '/api/tasks/message',
    { id: attempt.task.id, messageId: attempt.messageId, text: attempt.text },
    responses.ok,
  )
}
