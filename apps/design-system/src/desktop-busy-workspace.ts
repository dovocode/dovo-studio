import {
  decode,
  defaultTaskHarness,
  pendingQuestionSchema,
  workspaceSchema,
  type Workspace,
} from '../../../packages/protocol/src'
import { screenPull } from './desktop-screens-data'

// Deliberately synthetic reading/overflow evidence; no live runtime or provider results.
const date = '2026-10-21T10:00:00.000Z'
export const busyDesktopQuestion = decode(pendingQuestionSchema, {
  id: 'preview-busy-navigation-question',
  taskId: 'preview-busy-navigation',
  createdAt: date,
  prompt: {
    title: 'Confirm keyboard focus behavior',
    questions: [
      {
        id: 'project-focus',
        header: 'Project focus',
        question: 'Where should keyboard focus move after switching projects?',
        options: [
          { value: 'thread', label: 'Selected thread' },
          { value: 'project', label: 'Project heading' },
        ],
      },
    ],
  },
})
export const busyDesktopDraft = `Keep the blue accent and the current keyboard flow.
Check the attached screenshot at desktop and mobile widths.
Include remaining layout issues in the PR summary.`
const response = `The navigation changes are ready for a visual pass. The project name now anchors the header, while the active thread and its actions share a single row. Long titles wrap in the conversation header and stay on one line in the thread list.

### What changed

- **Project navigation:** each project keeps its own threads together, with the current thread clearly selected.
- **Conversation hierarchy:** user requests, progress updates and the final response have distinct spacing, without adding another container around each message.
- **Narrow workspaces:** opening Files reduces the conversation width without hiding the composer or pushing the page sideways.

The selected state comes from the active thread ID. That keeps the list and conversation in agreement when a user switches projects:

\`\`\`tsx
const selected = thread.id === activeThreadId

return (
  <ThreadRow
    thread={thread}
    selected={selected}
    onSelect={() => openThread(thread.id)}
  />
)
\`\`\`

### Review checklist

- [x] Keep the existing blue accent and soften the page background
- [x] Preserve keyboard navigation between threads and tools
- [x] Give long project names and branch labels a predictable overflow treatment
- [ ] Compare the mobile layout with the desktop workspace
- [ ] Review the attached screenshot before publishing

The branch is \`feature/navigation\`, linked to **PR #42**. In this synthetic preview, the two queued follow-ups below remain separate from the conversation so the current request stays easy to read. Open Files alongside the terminal to check whether the same hierarchy holds under everyday workspace density.`

export function busyDesktopWorkspace(base: Workspace, draft?: string): Workspace {
  const selected = base.tasks.find((task) => task.id === 'preview-task')
  if (!selected) throw new Error('Busy desktop preview requires the stable preview-task fixture.')
  return decode(workspaceSchema, {
    ...base,
    repositories: [
      ...base.repositories,
      {
        id: 'preview-client',
        name: 'Client portal',
        path: '/preview/client-portal',
        branch: 'main',
      },
      {
        id: 'preview-api',
        name: 'Operations API',
        path: '/preview/operations-api',
        branch: 'develop',
      },
    ],
    tasks: [
      {
        ...selected,
        draft: draft ?? selected.draft,
        title: 'Make project navigation easier to scan across a busy workspace',
        checkoutBranch: 'feature/navigation',
        execution: 'worktree',
        lastPromptAt: '2026-10-21T10:08:00.000Z',
        pullRequest: {
          provider: screenPull.pull.provider,
          number: screenPull.pull.number,
          url: screenPull.pull.url,
          repositoryUrl: screenPull.pull.repositoryUrl,
          headBranch: screenPull.pull.head,
          headSha: screenPull.pull.headSha,
          baseSha: screenPull.pull.baseSha,
        },
        pullStatus: {
          title: screenPull.pull.title,
          number: screenPull.pull.number,
          url: screenPull.pull.url,
          state: 'open',
          draft: true,
          checkedAt: date,
        },
        messages: [
          {
            id: 'preview-user-message',
            role: 'user',
            text: 'The project landing page is hard to scan once several threads are active. Make the navigation clearer and keep the current thread easy to find. Please preserve the existing keyboard flow.',
            createdAt: date,
          },
          {
            id: 'preview-assistant-message',
            role: 'assistant',
            text: 'I will review the project list, thread header and composer together. The first pass will keep the current layout and focus on selection, spacing and long titles.',
            createdAt: '2026-10-21T10:01:00.000Z',
          },
          {
            id: 'preview-busy-user-followup',
            role: 'user',
            text: 'Include the case where Files and the bottom terminal are both open. I often read a response while checking a change, and the conversation should still be comfortable at that width.',
            createdAt: '2026-10-21T10:04:00.000Z',
          },
          {
            id: 'preview-busy-assistant-progress',
            role: 'assistant',
            text: 'The shared layout is in place. I am checking the selected thread, long branch labels and queued messages with both panels open.',
            createdAt: '2026-10-21T10:06:00.000Z',
          },
          {
            id: 'preview-busy-user-review',
            role: 'user',
            text: 'Keep the follow-up queue visible. Show me what changed and what still needs a visual review.',
            createdAt: '2026-10-21T10:08:00.000Z',
          },
          {
            id: 'preview-busy-assistant-response',
            role: 'assistant',
            text: response,
            createdAt: '2026-10-21T10:09:00.000Z',
          },
        ],
      },
      ...[
        [
          'navigation',
          'Keep keyboard focus visible when switching projects and opening thread tools',
          'preview-project',
          'review',
          'codex',
        ],
        [
          'reconnect',
          'Recover the conversation after a laptop resumes on the local network',
          'preview-project',
          'running',
          'claude',
        ],
        [
          'upload',
          'Explain attachment upload failures without losing the current draft',
          'preview-client',
          'failed',
          'codex',
        ],
        [
          'billing',
          'Tighten invoice filters and preserve the selected date range on return',
          'preview-client',
          'review',
          'claude',
        ],
        [
          'onboarding',
          'Draft a shorter onboarding flow for first-time project administrators',
          'preview-client',
          'draft',
          'codex',
        ],
        [
          'pagination',
          'Fix cursor pagination when several activity events share a timestamp',
          'preview-api',
          'running',
          'codex',
        ],
        [
          'webhooks',
          'Document webhook delivery, retry limits and failure recovery',
          'preview-api',
          'done',
          'claude',
        ],
        [
          'health',
          'Add a clear health response for background workers and scheduled jobs',
          'preview-api',
          'review',
          'codex',
        ],
        [
          'archive',
          'Explore a compact archive view for completed maintenance threads',
          'preview-project',
          'cancelled',
          'claude',
        ],
      ].map(([id, title, repositoryId, status, provider], index) => ({
        id: `preview-busy-${id}`,
        title,
        repositoryId,
        status,
        agentId: provider === 'claude' ? 'preview-claude' : 'preview-codex',
        harness: defaultTaskHarness(provider === 'claude' ? 'claude' : 'codex'),
        activeRunId: status === 'running' ? `preview-busy-run-${id}` : undefined,
        waitingForFeedback: id === 'billing',
        // Keep the lifecycle fixture snoozed regardless of the capture machine's clock.
        snoozedUntil: id === 'onboarding' ? '2099-01-01T10:00:00.000Z' : undefined,
        createdAt: `2026-10-21T09:${String(50 - index).padStart(2, '0')}:00.000Z`,
        checkoutBranch: `feature/${id}`,
        messages: [
          { id: `preview-busy-message-${id}`, role: 'user', text: title, createdAt: date },
        ],
        files: [],
        draft: '',
        example: false,
      })),
    ],
  })
}
