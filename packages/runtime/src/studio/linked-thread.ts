import {
  decode,
  linkedThreadPageSchema,
  mutableStruct,
  parseStudioReference,
  type LinkedThreadRead,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError } from '../errors.js'
import type { Services } from '../services.js'
import { routedStudioTool, studioComputer } from './peers.js'

const routedPage = mutableStruct({
  thread: mutableStruct({ id: Schema.String, title: Schema.String, reference: Schema.String }),
  history: linkedThreadPageSchema.fields.history,
})

export async function readLinkedThread(
  s: Services,
  input: LinkedThreadRead,
  authenticate: () => void,
) {
  const link = s.threadWatch.linkedRead(input)
  const authorize = () => {
    authenticate()
    const current = s.threadWatch.linkedRead(input)
    const owner = studioComputer(s, current.runtimeId, input.parentTaskId)
    if (
      current.generation !== link.generation ||
      owner?.peer?.connection.runtimeId !== input.runtimeIdentity
    )
      throw new HttpError(409, 'This linked thread changed. Open it again from its parent.')
  }
  const value = await routedStudioTool(
    s,
    input.parentTaskId,
    'threads',
    { action: 'read', id: input.threadId, before: input.before },
    input.runtimeIdentity,
    authorize,
    link.policy,
  )
  const page = decode(routedPage, value)
  const reference = parseStudioReference(page.thread.reference)
  if (
    page.thread.id !== input.threadId ||
    reference?.runtimeId !== input.runtimeIdentity ||
    reference.kind !== 'thread' ||
    reference.id !== input.threadId
  )
    throw new HttpError(409, 'The linked computer returned a different thread.')
  return { title: page.thread.title.slice(0, 1000), history: page.history }
}
