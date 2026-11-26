import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AcpLaunch } from '../../execution/types.js'

export function antigravityProfile(launch: AcpLaunch) {
  if (launch.sandbox) return
  const profile =
    launch.env.GEMINI_HOME ??
    process.env.GEMINI_HOME ??
    join(launch.env.HOME ?? homedir(), '.gemini')
  if (isAbsolute(profile)) return profile
}

export const antigravitySessionId = /^[\w-]{1,128}$/
