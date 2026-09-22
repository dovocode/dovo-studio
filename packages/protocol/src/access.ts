import type { Agent } from './workspace.js'
export const accessModes = [
  {
    id: 'ask',
    name: 'Supervised',
    description: 'Ask you to review actions that require permission.',
  },
  {
    id: 'workspace-write',
    name: 'Auto-accept edits',
    description:
      'Allow workspace edits without asking. Actions outside that scope may still need approval.',
  },
  {
    id: 'auto',
    name: 'Auto',
    description:
      'Let the harness review and approve or deny actions. This is not unconditional approval.',
  },
  {
    id: 'full-access',
    name: 'Full access',
    description:
      'Run with the harness’s unrestricted access mode. Host and organization policies still apply.',
  },
  {
    id: 'read-only',
    name: 'Read only',
    description: 'Explore files without granting write access.',
  },
] as const
export function supportsAccess(provider: Agent['provider'], permission: Agent['permission']) {
  if (permission === 'auto') return provider === 'codex' || provider === 'claude'
  if (provider === 'acp') return permission === 'ask' || permission === 'read-only'
  return true
}
export function accessLabel(permission: Agent['permission']) {
  return accessModes.find((mode) => mode.id === permission)?.name ?? permission
}
