import { Schema } from 'effect'
import { mutableStruct, responses, type Task, type RuntimeProfile } from '@dovo/protocol'
import type { useWorkspace } from '@dovo/studio-core'
export type LauncherAttempt = {
  task: Task
  profile: RuntimeProfile
  messageId: string
  text: string
  created: boolean
}
/** Retain the creation and submission IDs across failures, including lost acknowledgements. */
export async function dispatchLauncherTask(
  attempt: LauncherAttempt,
  request: ReturnType<typeof useWorkspace>['readRuntime'],
) {
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
