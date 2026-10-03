import type { Agent } from './workspace/schema'
export const providers: Record<
  Agent['provider'],
  { name: string; short: string; description: string }
> = {
  codex: { name: 'Codex App Server', short: 'Codex', description: 'Local app-server process' },
  opencode: { name: 'OpenCode Serve', short: 'OpenCode', description: 'HTTP server connection' },
  claude: { name: 'Claude Agent SDK', short: 'Claude', description: 'Runtime-hosted SDK' },
  hermes: { name: 'Hermes Agent', short: 'Hermes', description: 'Local Hermes agent process' },
  copilot: {
    name: 'GitHub Copilot SDK',
    short: 'Copilot',
    description: 'Runtime-hosted Copilot SDK',
  },
  grok: { name: 'Grok Build', short: 'Grok', description: 'Local Grok coding agent' },
  muse: { name: 'Muse Code SDK', short: 'Muse', description: 'Local Muse session host' },
  acp: { name: 'Agent Client Protocol', short: 'ACP', description: 'Compatible agent process' },
}
