import { z } from 'zod'

// This experimental field is verified against the 0.155.1 generated protocol.
// Older servers can silently ignore unknown turn fields, so do not send it blindly.
export function supportsCodexDaybreak(initialize: unknown) {
  const response = z.object({ userAgent: z.string() }).safeParse(initialize)
  const version = response.success ? response.data.userAgent.match(/\/(\d+)\.(\d+)\.(\d+)\b/) : null
  if (!version) return false
  const [, major, minor, patch] = version.map(Number)
  return major > 0 || minor > 155 || (minor === 155 && patch >= 1)
}

export function daybreakProgram(model: string) {
  if (model === 'gpt-daybreak-blue-latest') return 'daybreakBlue' as const
  if (model === 'gpt-daybreak-red-latest') return 'daybreakRed' as const
  return undefined
}
