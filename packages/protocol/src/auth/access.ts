import type { Agent } from '../workspace.js'
export const accessModes = [
  {
    id: 'ask',
    name: 'Supervised',
    description: 'Ask before commands and file changes.',
  },
  {
    id: 'workspace-write',
    name: 'Auto-accept edits',
    description: 'Auto-approve edits, ask before other actions.',
  },
  {
    id: 'auto',
    name: 'Auto',
    description: 'Supported providers approve routine actions; others still ask.',
  },
  {
    id: 'full-access',
    name: 'Full access',
    description: 'Allow commands and edits without prompts.',
  },
] as const
const legacyReadOnly = {
  id: 'read-only',
  name: 'Read only',
  description: 'Explore files without granting write access.',
} as const
export function selectableAccessModes(current?: Agent['permission']) {
  return current === 'read-only' ? [...accessModes, legacyReadOnly] : accessModes
}
export function supportsAccess(provider: Agent['provider'], permission: Agent['permission']) {
  // These native hosts do not expose a restricted read-only session.
  return !['hermes', 'grok', 'muse'].includes(provider) || permission !== 'read-only'
}
export function accessLabel(permission: Agent['permission']) {
  return (
    selectableAccessModes(permission).find((mode) => mode.id === permission)?.name ?? permission
  )
}

/** These providers have no tool-disable boundary for utility prompts. */
export function supportsUtilities(provider: Agent['provider']) {
  return !['hermes', 'grok', 'muse'].includes(provider)
}
