import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { nativeEffect } from '../runtime/native-effect'
export type SendScope = { runtimeId: string; taskId: string }
type DraftContent = { text: string; attachmentIds: readonly string[] }
type SendInput = DraftContent & { mode: 'queue' | 'steer' }
export type SendAttempt = SendInput & { id: string; title?: string }

const sameFiles = (first: readonly string[], second: readonly string[]) =>
  first.length === second.length && first.every((id, index) => id === second[index])
const sameDraft = (attempt: DraftContent, draft: DraftContent) =>
  attempt.text === draft.text.trim() && sameFiles(attempt.attachmentIds, draft.attachmentIds)

/** Pending delivery belongs to a thread on a computer, not to its mounted composer. */
export function createSendAttempts(createId: () => string) {
  const attempts = new Map<string, SendAttempt>()
  const confirmed = new WeakSet<SendAttempt>()
  const key = ({ runtimeId, taskId }: SendScope) => JSON.stringify([runtimeId, taskId])
  const acknowledge = (scope: SendScope, id: string) => {
    const attempt = attempts.get(key(scope))
    if (attempt?.id !== id) return false
    confirmed.add(attempt)
    attempts.delete(key(scope))
    return true
  }
  const deliverEffect = <A, E>(scope: SendScope, attempt: SendAttempt, send: Effect.Effect<A, E>) =>
    send.pipe(
      Effect.catchAll((error) => (confirmed.has(attempt) ? Effect.void : Effect.fail(error))),
      Effect.map(() => acknowledge(scope, attempt.id)),
    )
  return {
    begin(scope: SendScope, input: SendInput) {
      const previous = attempts.get(key(scope))
      if (previous && previous.mode === input.mode && sameDraft(previous, input)) return previous
      const attempt: SendAttempt = {
        id: createId(),
        text: input.text.trim(),
        attachmentIds: [...input.attachmentIds],
        mode: input.mode,
      }
      attempts.set(key(scope), attempt)
      return attempt
    },
    setTitle(scope: SendScope, id: string, title: string) {
      const attempt = attempts.get(key(scope))
      if (attempt?.id === id) attempt.title = title
    },
    textChanged(scope: SendScope, text: string) {
      const attempt = attempts.get(key(scope))
      if (attempt && attempt.text !== text.trim()) attempts.delete(key(scope))
    },
    acknowledge,
    isConfirmed: (attempt: SendAttempt) => confirmed.has(attempt),
    deliverEffect,
    deliver: (scope: SendScope, attempt: SendAttempt, send: () => Promise<unknown>) =>
      runClientEffect(deliverEffect(scope, attempt, nativeEffect(send))),
    reconcile(scope: SendScope, draft: DraftContent, deliveredIds: readonly string[]) {
      const attempt = attempts.get(key(scope))
      if (!attempt) return false
      if (deliveredIds.includes(attempt.id)) {
        acknowledge(scope, attempt.id)
        // Acceptance consumes draft attachments. Those missing files are not a user edit.
        return (
          attempt.text === draft.text.trim() &&
          draft.attachmentIds.every((id) => attempt.attachmentIds.includes(id))
        )
      }
      if (!sameDraft(attempt, draft)) attempts.delete(key(scope))
      return false
    },
  }
}
