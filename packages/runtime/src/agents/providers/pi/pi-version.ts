import type { Agent } from '@dovo/protocol'
import { exec, processEnvironment } from '../../../process.js'

/** Pi 1.4 has the agent_settled event needed to wait for retries and compaction. */
export async function requirePiVersion(agent: Agent) {
  const { stdout } = await exec(agent.endpoint || 'pi', ['--version'], {
    timeout: 5000,
    maxBuffer: 64000,
    env: processEnvironment(agent.env),
  })
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(stdout)
  if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 4))
    throw new Error(
      'Pi continuation requires @earendil-works/pi-coding-agent 1.4 or newer. Install it on this computer with: npm install -g --ignore-scripts @earendil-works/pi-coding-agent. The older @mariozechner/pi-coding-agent does not report when retries and compaction have settled.',
    )
}
