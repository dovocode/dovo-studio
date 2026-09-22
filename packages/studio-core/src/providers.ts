import type { Agent } from './workspace/schema'
export const providers: Record<
  Agent['provider'],
  { name: string; short: string; description: string }
> = {
  codex: { name: 'Codex App Server', short: 'Codex', description: 'Local app-server process' },
  opencode: { name: 'OpenCode Serve', short: 'OpenCode', description: 'HTTP server connection' },
  claude: { name: 'Claude Agent SDK', short: 'Claude', description: 'Runtime-hosted SDK' },
  acp: { name: 'Agent Client Protocol', short: 'ACP', description: 'Compatible agent process' },
}
