import { expect, it, vi } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import { taskSchema, type Task } from '../workspace.js'
import { nextThreadDraft } from './next-thread-draft.js'

const configured: Task = {
  id: 'previous',
  title: 'Previous work',
  repositoryId: 'project',
  agentId: 'custom-agent',
  agentName: 'Project reviewer',
  agentIcon: 'shield',
  harness: {
    provider: 'codex',
    model: 'gpt-6.1-sol',
    reasoning: 'high',
    serviceTier: 'priority',
    instructions: 'Keep the project conventions.',
    endpoint: '',
    permission: 'read-only',
    approvalPolicy: 'on-request',
    sandboxMode: 'read-only',
    env: { TEST_SETTING: 'retained' },
  },
  harnessCustomized: true,
  agentOverrides: { model: 'custom-model', reasoning: 'high', permission: 'read-only' },
  draftTurnSettings: { provider: 'codex', model: 'next-model', reasoning: 'high' },
  draftPlan: true,
  execution: 'worktree',
  worktreeBaseBranch: 'develop',
  worktreeFromOrigin: false,
  worktreeIncludeChanges: true,
  setupCommand: 'pnpm install',
  submodules: 'recursive',
  linkedCheckouts: [
    { id: 'docs', repositoryId: 'documentation', execution: 'main', access: 'read-only' },
  ],
  status: 'draft',
  createdAt: '2026-10-30T00:00:00.000Z',
  messages: [],
  files: [],
  draft: 'The prompt to start in the background',
  example: false,
}

it('accepts an ID from the native platform without requiring browser crypto', () => {
  vi.stubGlobal('crypto', undefined)
  try {
    expect(nextThreadDraft(configured, 'native-generated-id').id).toBe('native-generated-id')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('retains configuration and permission limits in a fresh, schema-valid thread', () => {
  const next = nextThreadDraft(configured)
  expect(decode(taskSchema, next)).toMatchObject({
    repositoryId: 'project',
    agentId: 'custom-agent',
    agentName: 'Project reviewer',
    agentIcon: 'shield',
    harness: configured.harness,
    harnessCustomized: true,
    agentOverrides: configured.agentOverrides,
    draftTurnSettings: configured.draftTurnSettings,
    draftPlan: true,
    execution: 'worktree',
    worktreeBaseBranch: 'develop',
    worktreeFromOrigin: false,
    worktreeIncludeChanges: true,
    setupCommand: 'pnpm install',
    submodules: 'recursive',
    linkedCheckouts: configured.linkedCheckouts,
    status: 'draft',
    title: 'New thread',
    draft: '',
    messages: [],
    files: [],
  })
  expect(next.id).not.toBe(configured.id)
  expect(nextThreadDraft(configured).id).not.toBe(next.id)
  expect(next.createdAt).not.toBe(configured.createdAt)
  expect(configured.draft).toBe('The prompt to start in the background')
  expect(next.linkedCheckouts?.[0]).not.toBe(configured.linkedCheckouts?.[0])
})

it.each(['inherit', 'auto', 'smart'] as const)(
  'keeps automatic project selection and %s model mode unresolved for the next prompt',
  (modelSelection) => {
    const source = {
      ...configured,
      repositoryId: 'general',
      autoProject: true,
      autoProjectExecution: 'worktree',
      modelSelection,
      modelSelectionDifficulty: 'high',
    } satisfies Task
    expect(decode(taskSchema, nextThreadDraft(source))).toMatchObject({
      repositoryId: 'general',
      autoProject: true,
      autoProjectExecution: 'worktree',
      modelSelection,
      modelSelectionDifficulty: 'high',
    })
  },
)

it('never copies conversation, queued prompts, attachments or checkout ownership', () => {
  const source: Task = {
    ...configured,
    status: 'running',
    sessionId: 'provider-session',
    activeRunId: 'active-run',
    checkoutLocked: true,
    checkoutBranch: 'dovo/previous',
    providerLock: 'codex',
    worktreeSetupComplete: true,
    linkedCheckoutSetup: [{ id: 'docs', directory: '/previous-checkout' }],
    worktreeInitialSnapshot: { tree: 'old-tree', head: 'old-head' },
    draftAttachments: [{ id: 'upload', name: 'file.txt', mime: 'text/plain', size: 10 }],
    messages: [{ id: 'sent', role: 'user', text: 'Previous prompt' }],
    queue: [{ id: 'queued', role: 'user', text: 'Previous queue', createdAt: '' }],
    queuePaused: true,
    archived: true,
    nativeTodos: [{ text: 'Previous checklist', status: 'pending' }],
  }
  const next = nextThreadDraft(source)
  for (const field of [
    'sessionId',
    'activeRunId',
    'checkoutLocked',
    'checkoutBranch',
    'providerLock',
    'worktreeSetupComplete',
    'linkedCheckoutSetup',
    'worktreeInitialSnapshot',
    'draftAttachments',
    'queue',
    'queuePaused',
    'archived',
    'nativeTodos',
  ])
    expect(next).not.toHaveProperty(field)
  expect(next.messages).toEqual([])
  expect(source.messages).toHaveLength(1)
})
