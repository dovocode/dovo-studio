import { Schema } from 'effect'
import { decodeResult, mutableStruct, RUNTIME_PROTOCOL_VERSION } from '@dovo/protocol'

const healthSchema = mutableStruct({ owner: Schema.Boolean, protocolVersion: Schema.Number })

/** Readiness alone is insufficient: verify that this listener accepts this desktop's owner token. */
export async function checkRuntimeConnection(
  connection: { address: string; token: string },
  signal: AbortSignal = AbortSignal.timeout(10_000),
) {
  const response = await fetch(`${connection.address}/api/snapshot`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    redirect: 'error',
    signal,
  })
  if (response.status === 401 || response.status === 403)
    throw new Error(
      'The local runtime rejected the desktop credentials. Restart Dovo Studio to reconnect.',
    )
  if (!response.ok)
    throw new Error(`The local runtime health check failed (HTTP ${response.status}).`)
  const result = decodeResult(healthSchema, await response.json())
  if (!result.success)
    throw new Error(
      'The local runtime returned invalid connection data. Restart or update the matching runtime.',
    )
  const snapshot = result.data
  if (!snapshot.owner)
    throw new Error('The local runtime did not grant owner access to this desktop.')
  if (snapshot.protocolVersion !== RUNTIME_PROTOCOL_VERSION)
    throw new Error(
      'The local runtime is incompatible with this desktop version. Update or restart the matching runtime.',
    )
}
