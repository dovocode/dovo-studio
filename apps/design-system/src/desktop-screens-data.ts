import {
  decode,
  pullDetailSchema,
  forgeIssueDetailSchema,
  automationSchema,
  forgePipelineDetailSchema,
  forgeIssuePageSchema,
  forgePipelinePageSchema,
} from '../../../packages/protocol/src'
const date = '2026-10-21T10:00:00.000Z'
export const screenPull = decode(pullDetailSchema, {
  warnings: [],
  pull: {
    number: 42,
    title: 'Keep Dovo navigation consistent',
    url: 'https://github.com/dovo/studio/pull/42',
    state: 'open',
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
