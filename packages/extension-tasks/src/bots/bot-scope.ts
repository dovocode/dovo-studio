import type { RuntimeConnection } from '@dovo/protocol'

const pairings = new Map<string, number>()
/** Keep credentials out of component keys while separating re-pairings of the same runtime. */
export function botScope(
  runtimeId: string | null | undefined,
  connection?: RuntimeConnection | null,
) {
  const identity = JSON.stringify([runtimeId, connection?.address, connection?.token])
  let key = pairings.get(identity)
  if (key === undefined) {
    key = pairings.size + 1
    pairings.set(identity, key)
  }
  return key
}
