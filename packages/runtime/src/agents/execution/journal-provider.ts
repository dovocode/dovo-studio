import type { AgentAdapter, AgentRun } from './types.js'
import type { WorkspaceStore } from '../../storage/workspace.js'

/** A physical execution owns transcript/interaction callbacks and its durable dispatch record.
 * onSubagentEvent is intentionally session-owned and persists only native metadata. */
export function journalProvider(
  adapter: Pick<AgentAdapter, 'run'>,
  store: WorkspaceStore,
  id: string,
  turnId: string,
  acceptsProviderEvents: () => boolean,
): Pick<AgentAdapter, 'run'> {
  let providerAttempt = 0
  return {
    run: async (input: AgentRun) => {
      const ordinal = providerAttempt++
      const actionId = ordinal ? `start:${turnId}:repair:${ordinal}` : `start:${turnId}`
      if (ordinal)
        store.updateTask(id, (task) => task, undefined, {
          id: actionId,
          taskId: id,
          attemptId: turnId,
          kind: 'start',
          state: 'pending',
        })
      store.providerActions.transition(actionId, 'dispatched')
      let open = true
      let acknowledged = false
      let emittedLength = 0
      const active = () => open && acceptsProviderEvents()
      const acknowledge = () => {
        if (active() && !acknowledged) {
          store.providerActions.transition(actionId, 'acknowledged')
          acknowledged = true
        }
      }
      try {
        await adapter.run({
          ...input,
          onPromptAccepted: () => {
            if (active()) {
              input.onPromptAccepted?.()
              acknowledge()
            }
          },
          onText: (text) => {
            if (active()) {
              input.onText(text)
              emittedLength += text.length
              acknowledge()
            }
          },
          onTextReplace: input.onTextReplace
            ? (text, previousLength) => {
                if (active()) {
                  if (
                    !Number.isSafeInteger(previousLength) ||
                    previousLength < 0 ||
                    previousLength > emittedLength
                  )
                    throw new Error('Provider text replacement exceeds its streamed output')
                  input.onTextReplace?.(text, previousLength)
                  emittedLength += text.length - previousLength
                  acknowledge()
                }
              }
            : undefined,
          onTextBoundary: () => {
            if (active()) input.onTextBoundary?.()
          },
          onEvent: (name, payload) => {
            if (active()) input.onEvent?.(name, payload)
          },
          onActivity: (text) => {
            if (active()) input.onActivity(text)
          },
          onSession: (sessionId) => {
            if (active()) input.onSession(sessionId)
          },
          onQuestions: (prompt) => {
            if (active()) {
              input.onQuestions?.(prompt)
              acknowledge()
            }
          },
          onSteer: (steer) => {
            if (active()) input.onSteer?.(steer)
          },
          ask: (...args) => (active() ? input.ask(...args) : Promise.resolve(null)),
          approve: (...args) => (active() ? input.approve(...args) : Promise.resolve(false)),
        })
        store.providerActions.transition(actionId, 'completed')
      } finally {
        open = false
        input.onSteer?.(undefined)
      }
    },
  }
}
