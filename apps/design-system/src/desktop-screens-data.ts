import {
  decode,
  pullDetailSchema,
  forgeIssueDetailSchema,
  automationSchema,
  forgePipelineDetailSchema,
  forgeIssuePageSchema,
  forgePipelinePageSchema,
  pullPageSchema,
} from '../../../packages/protocol/src'
const date = '2026-10-21T10:00:00.000Z'
export const screenPull = decode(pullDetailSchema, {
  capabilities: {
    actions: ['comment', 'review', 'edit', 'reviewers', 'merge', 'draft', 'auto-merge', 'close'],
    reviewDecisions: ['comment', 'approve', 'request-changes'],
    mergeMethods: ['squash', 'merge', 'rebase'],
  },
  warnings: [],
  pull: {
    number: 42,
    title: 'Keep Dovo navigation consistent',
    url: 'https://github.com/dovo/studio/pull/42',
    state: 'open',
    checksState: 'FAILURE',
    reviewDecision: 'REVIEW_REQUIRED',
    draft: false,
    author: 'preview-author',
    updatedAt: date,
    head: 'feature/navigation',
    base: 'main',
    labels: ['design-system'],
    provider: 'github',
    repositoryUrl: 'https://github.com/dovo/studio',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    body: '## Summary\n\nUse the shared navigation and settings patterns across Dovo.',
    additions: 18,
    deletions: 4,
    changedFiles: 1,
    mergeable: true,
    reviewers: ['preview-reviewer'],
    assignees: ['preview-author'],
  },
  comments: [
    {
      id: 'comment-preview',
      author: 'preview-reviewer',
      body: 'The compact layout is ready for review.',
      date,
      kind: 'comment',
      url: 'https://github.com/dovo/studio/pull/42#comment-preview',
    },
  ],
  checks: [
    { name: 'UI consistency', status: 'SUCCESS', summary: 'Shared component checks passed.' },
  ],
  files: [
    {
      path: 'src/navigation.tsx',
      status: 'modified',
      additions: 18,
      deletions: 4,
      patch: '@@ -1 +1 @@\n-export const label = "Menu"\n+export const label = "Projects"',
    },
  ],
})
export const screenIssue = decode(forgeIssueDetailSchema, {
  issue: {
    id: '27',
    title: 'Unify sidebar selection and page headers',
    body: 'Use the same selected state, spacing and hierarchy on desktop and mobile.\n\n- [x] Define tokens\n- [ ] Review screen compositions',
    state: 'open',
    url: 'https://github.com/dovo/studio/issues/27',
    author: 'preview-author',
    assignees: ['preview-reviewer'],
    labels: ['design-system', 'ui'],
    updatedAt: date,
    revision: 'preview-1',
  },
  comments: [
    {
      id: 'issue-comment',
      body: 'Please compare the narrow layout as well.',
      author: 'preview-reviewer',
      createdAt: date,
    },
  ],
})
export const screenAutomation = decode(automationSchema, {
  id: 'preview-automation',
  name: 'Review UI changes',
  enabled: false,
  nodes: [
    {
      id: 'preview-trigger',
      type: 'automation',
      position: { x: 40, y: 80 },
      data: {
        kind: 'trigger',
        label: 'Manual start',
        trigger: 'manual',
        schedule: '',
        timezone: 'UTC',
        objective: '',
        agentId: '',
        repositoryId: 'preview-project',
      },
    },
    {
      id: 'preview-step',
      type: 'automation',
      position: { x: 360, y: 80 },
      data: {
        kind: 'task',
        label: 'Audit component changes',
        trigger: 'manual',
        schedule: '',
        timezone: 'UTC',
        objective: 'Review changed UI components and report inconsistencies.',
        agentId: 'preview-codex',
        repositoryId: 'preview-project',
      },
    },
    {
      id: 'preview-review',
      type: 'automation',
      position: { x: 680, y: 80 },
      data: {
        kind: 'review',
        label: 'Owner approval',
        trigger: 'manual',
        schedule: '',
        timezone: 'UTC',
        objective: 'Approve the UI changes before publishing.',
        agentId: '',
        repositoryId: 'preview-project',
      },
    },
  ],
  edges: [
    { id: 'preview-edge-1', source: 'preview-trigger', target: 'preview-step' },
    { id: 'preview-edge-2', source: 'preview-step', target: 'preview-review' },
  ],
})

export const screenPipeline = decode(forgePipelineDetailSchema, {
  run: {
    id: 'preview-run-42',
    number: '42',
    title: 'Verify consistent UI components',
    url: 'https://github.com/dovo/studio/actions/runs/42',
    ref: 'feature/navigation',
    sha: 'a'.repeat(40),
    actor: 'preview-author',
    status: 'failure',
    createdAt: date,
    updatedAt: date,
    startedAt: date,
    completedAt: '2026-10-21T10:03:00.000Z',
    workflow: 'Check',
    event: 'push',
    attempt: 1,
  },
  jobs: [
    {
      id: 'preview-build',
      name: 'Build',
      status: 'success',
      url: 'https://github.com/dovo/studio/actions/runs/42/job/1',
      steps: [{ id: 'preview-build-step', name: 'Compile packages', status: 'success', number: 1 }],
    },
    {
      id: 'preview-browser',
      name: 'Browser checks',
      status: 'failure',
      url: 'https://github.com/dovo/studio/actions/runs/42/job/2',
      errors: ['The narrow sidebar exceeds its container.'],
      steps: [
        {
          id: 'preview-browser-step',
          name: 'Check responsive layout',
          status: 'failure',
          number: 1,
          errors: ['Expected the sidebar to collapse at compact width.'],
        },
      ],
    },
  ],
  graph: [
    { id: 'build', name: 'Build', needs: [], jobIds: ['preview-build'] },
    { id: 'browser', name: 'Browser checks', needs: ['build'], jobIds: ['preview-browser'] },
  ],
})

export const screenIssuePage = decode(forgeIssuePageSchema, {
  destination: 'preview-destination',
  items: [screenIssue.issue],
})
export const screenPipelinePage = decode(forgePipelinePageSchema, {
  destination: 'preview-destination',
  items: [screenPipeline.run],
})

// Deliberately separate from the small default fixtures used by focused interaction checks.
const denseTitles = [
  'Reconnect to a paired computer without losing the active thread or its queued messages',
  'Fix keyboard focus',
  'Keep project selection stable when a VPN computer reconnects during a long running review',
  'Show branch tracking status',
  'Preserve the three line composer draft while switching between project tools and terminal',
  'Improve empty states',
  'Display the selected account and project before opening a pull request from another computer',
  'Refresh stale checks',
  'Let reviewers compare staged and working files independently before preparing a commit',
  'Clarify runtime labels',
  'Keep unsaved agent instructions visible when scrolling through connection and model options',
  'Trim sidebar spacing',
  'Restore issue list scroll position after reviewing a discussion with a long project title',
  'Align action menus',
]
export const denseScreenPullPage = decode(pullPageSchema, {
  destination: 'preview-destination',
  page: 1,
  hasMore: false,
  pulls: denseTitles.map((title, index) => ({
    ...screenPull.pull,
    number: 142 - index,
    title,
    url: `https://github.com/dovo/studio/pull/${142 - index}`,
    author: ['dominic', 'sam-chen', 'alex-rivera', 'robin'][index % 4],
    updatedAt: `2026-10-${String(29 - index).padStart(2, '0')}T${String(9 + (index % 8)).padStart(2, '0')}:24:00.000Z`,
    head: [
      'fix/runtime-reconnection-and-queued-thread-continuity',
      'fix/keyboard-focus',
      'feature/project-runtime-selection',
      'chore/branch-status',
    ][index % 4],
    base: index === 4 ? 'feature/composer-tools' : 'main',
    draft: index % 5 === 2,
    checksState: ['FAILURE', 'SUCCESS', 'PENDING', null][index % 4],
    reviewDecision: ['CHANGES_REQUESTED', 'APPROVED', 'REVIEW_REQUIRED'][index % 3],
    viewerReviewRequested: index % 4 === 0,
    labels: index % 3 === 0 ? ['ui', 'needs-review', 'runtime'] : ['maintenance'],
    additions: [68, 3, 142, 24][index % 4],
    deletions: [12, 1, 38, 5][index % 4],
    commentCount: [8, 0, 3, 12][index % 4],
  })),
})
export const denseScreenIssuePage = decode(forgeIssuePageSchema, {
  destination: 'preview-destination',
  items: denseTitles.map((title, index) => ({
    ...screenIssue.issue,
    id: String(87 - index),
    title,
    url: `https://github.com/dovo/studio/issues/${87 - index}`,
    state: index % 4 === 2 ? 'closed' : 'open',
    author: ['dominic', 'sam-chen', 'alex-rivera'][index % 3],
    assignees: index % 4 === 0 ? [] : [index % 2 === 0 ? 'robin' : 'dominic'],
    labels: index % 3 === 0 ? ['bug', 'runtime', 'needs-triage'] : ['ui'],
    updatedAt: `2026-10-${String(29 - index).padStart(2, '0')}T10:24:00.000Z`,
    revision: `preview-dense-${index}`,
  })),
})
