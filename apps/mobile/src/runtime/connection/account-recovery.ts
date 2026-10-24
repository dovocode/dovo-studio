import {
  isPeerAddress,
  mergeAccountInternetConnection,
  upsertRuntime,
  type AccountDirectory,
  type RuntimeConnection,
  type RuntimeOverview,
  type RuntimeProfile,
  type RuntimeRegistry,
} from '@dovo/protocol'

/** Route discovery may update addresses during recovery; credentials and user choices may not. */
export const accountConnectionKey = (connection: RuntimeConnection) =>
  JSON.stringify([
    connection.address,
    connection.token,
    connection.runtimeId,
    connection.accountSession,
    connection.peer,
    connection.internet,
  ])

export function accountRecoveryTarget(
  entry: RuntimeOverview,
  directory: AccountDirectory,
  session: string,
) {
  const connection = entry.profile.connection
  // A manually paired WebRTC connection owns its own capabilities and relay consent.
  if (connection.peer && !connection.accountSession) return
  if (entry.snapshot?.relaySettings?.connectionMode === 'lan') return
  if (connection.accountSession && connection.accountSession !== session) return
  if (connection.internet && connection.internet.session !== session) return
  const hasInternet = !!(connection.accountSession || connection.internet)
  if (hasInternet && (entry.connected || !entry.error)) return
  return directory.servers.find(
    (server) => server.id === connection.runtimeId && server.internet?.online,
  )
}

export function renewedAccountConnection(previous: RuntimeConnection, incoming: RuntimeConnection) {
  if (!incoming.peer) throw new Error('Computer did not provide an encrypted connection')
  const saved = previous.accountSession ? previous.peer : previous.internet?.peer
  return saved ? { ...incoming, peer: { ...incoming.peer, relay: saved.relay } } : incoming
}

/** Commit only to the existing pairing. Automatic recovery must never recreate a forgotten
 * computer, undo a manual connection change, or select another computer. */
export function saveRecoveredAccountConnection(
  registry: RuntimeRegistry,
  previous: RuntimeProfile,
  incoming: RuntimeConnection,
  session: string | null,
): RuntimeRegistry {
  const current = registry.profiles.find((item) => item.id === previous.id)
  if (
    !session ||
    incoming.accountSession !== session ||
    !incoming.peer ||
    !incoming.runtimeId ||
    incoming.runtimeId !== previous.connection.runtimeId ||
    !current ||
    accountConnectionKey(current.connection) !== accountConnectionKey(previous.connection) ||
    (isPeerAddress(current.connection.address) && !current.connection.accountSession)
  )
    throw new Error('Computer or account changed while reconnecting. Try again.')
  return upsertRuntime(
    registry,
    { ...current, connection: mergeAccountInternetConnection(current.connection, incoming) },
    false,
  )
}
