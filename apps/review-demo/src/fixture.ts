import {
  decode,
  snapshotSchema,
  defaultTaskHarness,
  type Task,
  type RuntimeSnapshot,
} from '@dovo/protocol'

/** Pure fictional wire data. This service imports no runtime, agent, filesystem or command services. */
export function reviewSnapshot(): RuntimeSnapshot {
  const createdAt = '2026-10-19T09:41:00.000Z'
  const task = (id: string, title: string, prompt: string, reply: string): Task => ({
    id,
    title,
    repositoryId: 'demo-project',
    agentId: '',
    status: 'review',
    harness: { ...defaultTaskHarness('codex'), permission: 'read-only' },
    createdAt,
    draft: '',
    example: false,
    files: [],
    messages: [
      { id: id + '-user', role: 'user', text: prompt, createdAt },
      { id: id + '-reply', role: 'assistant', text: reply, createdAt },
    ],
  })
  const greeting = task(
    'demo-review',
    'Make greetings feel personal',
    'Handle blank names and make the greeting more welcoming.',
    'This is a simulated review workspace. The sample greeting trims whitespace, uses a friendly fallback and adds punctuation. Open Files to inspect the fictional diff. No code was executed and no AI provider was contacted.',
  )
  greeting.files = [
    {
      path: 'src/greeting.ts',
      viewed: false,
      before: "export function greeting(name: string) {\n  return 'Hello, ' + name\n}\n",
      after:
        "export function greeting(name: string) {\n  const displayName = name.trim() || 'there'\n  return `Hello, ${displayName}!`\n}\n",
    },
  ]
  greeting.nativeTodos = [
    { text: 'Inspect the greeting', status: 'completed' },
    { text: 'Review the sample diff', status: 'pending' },
  ]
  return decode(snapshotSchema, {
    protocolVersion: 2,
    runtimeId: 'dovo-isolated-review-demo',
    runtimeInstanceId: 'review-demo',
    runtimeHost: 'Dovo review demo · simulated',
    revision: 1,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [
        {
          id: 'demo-project',
          name: 'Fictional demo workspace',
          path: '/demo/fictional-workspace',
          branch: 'main',
        },
      ],
      tasks: [
        greeting,
        task(
          'demo-plan',
          'Plan the next release',
          'Prepare a short release checklist.',
          'Sample checklist: review the diff, run project checks on your own runtime, test mobile navigation, then publish when ready.',
        ),
        task(
          'demo-docs',
          'Clarify the setup guide',
          'Explain how to connect a phone to a computer.',
          'Pair each computer explicitly using a fresh pairing code. Dovo account sign-in is optional for direct connections. This demo is not linked to any real computer.',
        ),
      ],
      automations: [],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    owner: false,
  })
}
