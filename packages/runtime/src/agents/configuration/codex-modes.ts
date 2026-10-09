import { mutableStruct } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'

function codexVersion(initialize: unknown) {
  const response = decodeResult(mutableStruct({ userAgent: Schema.String }), initialize)
  const match = response.success ? response.data.userAgent.match(/\/(\d+)\.(\d+)\.(\d+)\b/) : null
  return match
    ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
    : undefined
}
// Experimental fields must only be enabled on a protocol version verified to support them.
export function supportsCodexDaybreak(initialize: unknown) {
  const version = codexVersion(initialize)
  if (!version) return false
  const { major, minor, patch } = version
  return major > 0 || minor > 155 || (minor === 155 && patch >= 1)
}
// Verified against the 0.161.0 feature catalog; older versions keep their native steering behavior.
export function supportsCodexInstantInterrupt(initialize: unknown) {
  const version = codexVersion(initialize)
  if (!version) return false
  const { major, minor } = version
  return major > 0 || minor >= 161
}
export function daybreakProgram(model: string) {
  if (model === 'gpt-daybreak-blue-latest') return 'daybreakBlue' as const
  if (model === 'gpt-daybreak-red-latest') return 'daybreakRed' as const
  return undefined
}
