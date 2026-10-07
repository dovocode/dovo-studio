import { exec, executableAvailable, processEnvironment } from '../../process.js'
import { decodeResult, type AgentDiscovery } from '@dovo/protocol'
import { Schema } from 'effect'
import { homedir } from 'node:os'
import { join } from 'node:path'
export async function claudeAuthenticated(agent: AgentDiscovery): Promise<boolean> {
  try {
    const command = await claudeCommand(agent.endpoint, agent.env)
    const { stdout } = await exec(command, ['auth', 'status', '--json'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      env: processEnvironment(agent.env),
    })
    const status = decodeResult(Schema.Struct({ loggedIn: Schema.Boolean }), JSON.parse(stdout))
    return status.success && status.data.loggedIn
  } catch {
    return false
  }
}
export async function claudeCommand(endpoint: string, env?: Record<string, string>) {
  const command = endpoint || 'claude'
  if (await executableAvailable(command, env)) return command
  // Native Claude installs here. WSL and background services do not necessarily
  // inherit the interactive shell's PATH; explicit executables still take precedence.
  if (command === 'claude' && process.platform !== 'win32') {
    const local = join(env?.HOME || homedir(), '.local', 'bin', 'claude')
    if (await executableAvailable(local, env)) return local
  }
  throw new Error(
    `Claude CLI not found or could not run: ${command}. Install Claude Code on this runtime host, or configure its executable path in runtime settings. For WSL, install and sign in inside the selected Linux distribution.`,
  )
}
