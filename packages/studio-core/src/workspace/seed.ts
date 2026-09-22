import type { Workspace } from './schema'

export function createWorkspace(): Workspace {
  return {
    version: 1,
    runtimeAddress: '',
    repositories: [
      { id: 'studio', name: 'dovo-studio', path: '~/Code/dovocode/dovo-studio', branch: 'main' },
    ],
    agents: [
      {
        id: 'builder',
        name: 'Builder',
        provider: 'codex',
        model: '',
        instructions:
          'Read repository instructions. Make the smallest complete change and verify it.',
        permission: 'ask',
        endpoint: '',
      },
      {
        id: 'reviewer',
        name: 'Reviewer',
        provider: 'opencode',
        model: '',
        instructions: 'Review code for correctness. Explain concrete issues and their impact.',
        permission: 'read-only',
        endpoint: 'http://127.0.0.1:4096',
      },
      {
        id: 'maintainer',
        name: 'Maintainer',
        provider: 'claude',
        model: '',
        instructions: 'Investigate failures and fix the root cause. Preserve unrelated changes.',
        permission: 'ask',
        endpoint: '',
      },
      {
        id: 'generalist',
        name: 'Generalist',
        provider: 'acp',
        model: '',
        instructions: 'Complete the task and report verification results.',
        permission: 'ask',
        endpoint: '',
      },
    ],
    tasks: [],
    automations: [
      {
        id: 'morning-review',
        name: 'Morning repository review',
        nodes: [
          {
            id: 'trigger',
            type: 'automation',
            position: { x: 60, y: 170 },
            data: {
              kind: 'trigger',
              label: 'Every weekday',
              trigger: 'schedule',
              schedule: '0 9 * * 1-5',
              timezone: 'Europe/Amsterdam',
              objective: '',
              agentId: '',
              repositoryId: '',
            },
          },
          {
            id: 'task',
            type: 'automation',
            position: { x: 400, y: 170 },
            data: {
              kind: 'task',
              label: 'Review recent changes',
              trigger: 'manual',
              schedule: '',
              timezone: 'Europe/Amsterdam',
              objective:
                'Review recent changes and report concrete bugs. Suggest the smallest useful fixes.',
              agentId: 'reviewer',
              repositoryId: 'studio',
            },
          },
          {
            id: 'review',
            type: 'automation',
            position: { x: 740, y: 170 },
            data: {
              kind: 'review',
              label: 'Human review',
              trigger: 'manual',
              schedule: '',
              timezone: '',
              objective: '',
              agentId: '',
              repositoryId: '',
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'task' },
          { id: 'e2', source: 'task', target: 'review' },
        ],
      },
    ],
  }
}
