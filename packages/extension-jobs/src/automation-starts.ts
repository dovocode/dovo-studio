import type { RuntimeConnection } from '@dovo/studio-core'

// A lost run acknowledgement must retain its idempotency key when its detail unmounts.
const attempts = new Map<string, string>()
const scope = (connection: RuntimeConnection, id: string) =>
  JSON.stringify([new URL(connection.address).origin, connection.token, id])

export function pendingAutomationStart(connection: RuntimeConnection, id: string) {
  return attempts.get(scope(connection, id))
}
export function automationStartRequest(connection: RuntimeConnection, id: string) {
  const key = scope(connection, id)
  const request = attempts.get(key) ?? crypto.randomUUID()
  attempts.set(key, request)
  return request
}
export function acknowledgeAutomationStart(
  connection: RuntimeConnection,
  id: string,
  request: string,
) {
  const key = scope(connection, id)
  if (attempts.get(key) === request) attempts.delete(key)
}
