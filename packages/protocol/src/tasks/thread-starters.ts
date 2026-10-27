/** Draft prompts shared by desktop and mobile. Choosing one never submits a turn. */
export const THREAD_STARTERS = [
  { id: 'build', label: 'Build something', prompt: 'Help me build ' },
  { id: 'fix', label: 'Fix a bug', prompt: 'Help me investigate and fix this issue: ' },
  { id: 'understand', label: 'Understand code', prompt: 'Help me understand ' },
  { id: 'plan', label: 'Plan a change', prompt: 'Help me plan this change: ' },
] as const
