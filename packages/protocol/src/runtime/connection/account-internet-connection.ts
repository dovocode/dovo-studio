import type { RuntimeConnection } from './runtime.js'
import { isPeerAddress } from './peer.js'
/** Preserve explicit pairing and its credential; account access is a distinct fallback. */
export function mergeAccountInternetConnection(
  previous: RuntimeConnection | undefined,
  incoming: RuntimeConnection,
): RuntimeConnection {
  if (!previous || !incoming.runtimeId || previous.runtimeId !== incoming.runtimeId) return incoming
  if (incoming.accountSession && incoming.peer && !isPeerAddress(previous.address))
    return {
      ...previous,
      internet: {
        address: incoming.address,
        token: incoming.token,
        peer: incoming.peer,
        runtimeId: incoming.runtimeId,
        session: incoming.accountSession,
      },
    }
  if (!isPeerAddress(incoming.address)) {
    const internet =
      previous.accountSession && previous.peer
        ? {
            address: previous.address,
            token: previous.token,
            peer: previous.peer,
            runtimeId: incoming.runtimeId,
            session: previous.accountSession,
          }
        : previous.internet
    return { ...incoming, ...(internet ? { internet } : {}) }
  }
  return incoming
}
