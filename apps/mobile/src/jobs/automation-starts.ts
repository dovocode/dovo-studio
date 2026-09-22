/** Pending start identities survive native back/reopen without starting the automation twice. */
export function createAutomationStarts() {
  const pending = new Map<string, string>()
  const key = (runtimeId: string, automationId: string) => JSON.stringify([runtimeId, automationId])
  return {
    get: (runtimeId: string, automationId: string) => pending.get(key(runtimeId, automationId)),
    begin(runtimeId: string, automationId: string, createId: () => string) {
      const scope = key(runtimeId, automationId)
      const id = pending.get(scope) ?? createId()
      pending.set(scope, id)
      return id
    },
    complete(runtimeId: string, automationId: string, id: string) {
      const scope = key(runtimeId, automationId)
      if (pending.get(scope) === id) pending.delete(scope)
    },
  }
}

export const automationStarts = createAutomationStarts()
