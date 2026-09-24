import { executableAvailable } from '../process.js'
export async function claudeCommand(endpoint: string) {
  const command = endpoint || 'claude'
  if (!(await executableAvailable(command)))
    throw new Error(
      `Claude CLI not found or could not run: ${command}. Install Claude Code on this runtime host, or configure its executable path in runtime settings.`,
    )
  return command
}
