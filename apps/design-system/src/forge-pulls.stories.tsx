import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ReactNode } from 'react'
import { PullRow } from '../../../packages/extension-scm/src/pulls/list/row'
import { PullStatus } from '../../../packages/extension-scm/src/pulls/detail/status'
import { PullStack } from '../../../packages/extension-scm/src/pulls/detail/stack'
import { PullPipelineRuns } from '../../../packages/extension-scm/src/pulls/detail/pipeline-runs'
import {
  decode,
  pullDetailSchema,
  pullSummarySchema,
  type PullSummary,
} from '../../../packages/protocol/src'
import { ComposerFixtureProvider, useComposerFixture } from './composer-fixture'

const now = '2026-10-21T10:00:00.000Z'
const repo = 'https://github.com/dovo/studio'
const repository = 'dovo/studio'
const revision = 'abcdef0123456789abcdef0123456789abcdef01'

function summary(
  value: Partial<PullSummary> & Pick<PullSummary, 'number' | 'title' | 'state' | 'draft'>,
) {
  return decode(pullSummarySchema, {
    ...value,
    url: value.url ?? `${repo}/pull/${value.number}`,
    author: value.author ?? 'Dominic',
    updatedAt: value.updatedAt ?? now,
    head: value.head ?? `feature/pull-${value.number}`,
    base: value.base ?? 'main',
    labels: value.labels ?? [],
    additions: value.additions ?? 128,
    deletions: value.deletions ?? 37,
    commentCount: value.commentCount ?? 4,
  })
}

const rowPulls = [
  summary({
    number: 81,
    title:
      'Stabilize WebRTC connections across changing networks and improve the complete React Native setup guidance',
    state: 'open',
    draft: false,
    checksState: 'FAILURE',
    reviewDecision: 'CHANGES_REQUESTED',
    viewerIsAuthor: true,
    labels: ['webrtc', 'react-native', 'needs follow-up'],
  }),
  summary({
    number: 82,
    title: 'Refactor pull request status refresh into the task detail view',
    state: 'open',
    draft: true,
    checksState: 'EXPECTED',
    reviewDecision: 'REVIEW_REQUIRED',
  }),
  summary({
    number: 83,
    title: 'Document the local pull request preview workflow',
    state: 'merged',
    draft: false,
    checksState: 'SUCCESS',
    reviewDecision: 'APPROVED',
  }),
]

const detail = decode(pullDetailSchema, {
  pull: {
    ...rowPulls[0],
    provider: 'github',
    body: 'Synthetic pull request detail for the production status components.',
    repositoryUrl: repo,
    headSha: revision,
    baseSha: '0123456789abcdef0123456789abcdef01234567',
    additions: 128,
    deletions: 37,
    changedFiles: 6,
    mergeable: false,
    reviewers: ['alex-reviewer', 'sam-reviewer'],
    assignees: ['Dominic'],
  },
  stack: {
    rootNumber: 80,
    position: 2,
    size: 3,
    parentNumber: 80,
    complete: true,
    members: [
      {
        number: 80,
        title: 'Introduce resilient signaling retries',
        url: `${repo}/pull/80`,
        head: 'feature/signaling',
        base: 'main',
        draft: false,
        depth: 0,
      },
      {
        number: 81,
        title: rowPulls[0].title,
        url: `${repo}/pull/81`,
        head: 'feature/pull-81',
        base: 'feature/signaling',
        draft: false,
        parentNumber: 80,
        depth: 1,
      },
      {
        number: 82,
        title: 'Add native connection recovery coverage',
        url: `${repo}/pull/82`,
        head: 'feature/pull-82',
        base: 'feature/pull-81',
        draft: true,
        parentNumber: 81,
        depth: 2,
      },
    ],
  },
  comments: [
    {
      id: 'review-requested',
      author: 'Alex Reviewer',
      body: 'Please handle the reconnect path when signaling restarts.',
      date: now,
      url: `${repo}/pull/81#discussion_r1`,
      kind: 'review',
      state: 'CHANGES_REQUESTED',
    },
    {
      id: 'review-approved',
      author: 'Sam Reviewer',
      body: 'The test coverage looks good.',
      date: now,
      url: `${repo}/pull/81#discussion_r2`,
      kind: 'review',
      state: 'APPROVED',
    },
  ],
  checks: [
    {
      name: 'web / typecheck — React Native platform matrix',
      status: 'SUCCESS',
      url: `${repo}/actions/runs/1001`,
      summary: 'Typecheck passed on the supported web and native targets.',
    },
    {
      name: 'native / reconnects after a signaling server restart',
      status: 'FAILURE',
      url: `${repo}/actions/runs/1002`,
      summary: 'Reconnect timed out after the signaling server became available again.',
      details: 'Expected connection state `connected`; observed `connecting` after 30 seconds.',
      annotations: [
        {
          path: 'apps/mobile/src/webrtc/reconnect.ts',
          startLine: 118,
          endLine: 120,
          level: 'failure',
          title: 'Reconnect deadline exceeded',
          message: 'Retry scheduling did not resume after the signaling channel reopened.',
        },
      ],
    },
    {
      name: 'integration / TURN relay smoke test',
      status: 'IN_PROGRESS',
      url: `${repo}/actions/runs/1003`,
    },
  ],
  files: [],
  warnings: [],
})

const meta = {
  title: 'Dovo/Patterns/Forge pull requests',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'These are production extension-SCM pull request components. PullRow owns list-row status and local row actions; PullStatus composes real CI signals, latest review badges, reviewer requests, and mergeability; PullStack owns the dependency list. Stories use schema-decoded synthetic data and intercept every link. No forge service or avatar URL is contacted.',
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function LocalLinks({ children }: { children: ReactNode }) {
  return (
    <div
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
      }}
    >
      {children}
    </div>
  )
}

function PullRowsExample() {
  const [selected, setSelected] = useState(rowPulls[0].number)
  const [added, setAdded] = useState<number[]>([])
  return (
    <LocalLinks>
      <section className="@container/pr-list mx-auto max-w-5xl space-y-2 rounded-xl border bg-card p-3">
        <header className="flex flex-wrap items-center gap-2 px-2 pb-1 text-xs text-muted-foreground">
          <span>Production PullRow · {repository}</span>
          <span className="ml-auto">Selected #{selected}</span>
          <span>
            Added to thread:{' '}
            {added.length ? added.map((number) => `#${number}`).join(', ') : 'none'}
          </span>
        </header>
        {rowPulls.map((pull) => (
          <PullRow
            statusColumn
            key={pull.number}
            pull={pull}
            repository={repository}
            selected={selected === pull.number}
            onSelect={() => setSelected(pull.number)}
            onAddToThread={() =>
              setAdded((current) =>
                current.includes(pull.number) ? current : [...current, pull.number],
              )
            }
            selectionCount={added.length || 1}
          />
        ))}
      </section>
    </LocalLinks>
  )
}

function PullDetailBlocks() {
  const [selected, setSelected] = useState(detail.pull.number)
  const [message, setMessage] = useState('')
  return (
    <LocalLinks>
      <div className="@container/pr-detail mx-auto max-w-5xl space-y-4">
        <section className="rounded-xl border bg-card p-4">
          <p className="mb-4 text-xs text-muted-foreground">
            #{detail.pull.number} · Open · review changes requested · CI failure
          </p>
          <PullStatus detail={detail} />
        </section>
        <PullStack
          detail={detail}
          connected
          onSelect={(number) => {
            setSelected(number)
            setMessage(`Selected PR #${number} locally.`)
          }}
          onCreate={() => setMessage('Stack PR action previewed locally.')}
          onUpdate={() => setMessage('Update-stack request previewed locally.')}
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Current local selection: #{selected}. {message}
        </p>
      </div>
    </LocalLinks>
  )
}

function OfflinePipelineExample() {
  const { setConnected } = useComposerFixture()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setConnected(false)
    setReady(true)
  }, [setConnected])
  if (!ready)
    return <p className="text-xs text-muted-foreground">Preparing disconnected pipeline preview…</p>
  return <PullPipelineRuns repositoryId="preview-project" sha={revision} />
}

const withFixture = (content: ReactNode) => (
  <ComposerFixtureProvider>
    <LocalLinks>{content}</LocalLinks>
  </ComposerFixtureProvider>
)

export const PullRows: Story = {
  render: () => withFixture(<PullRowsExample />),
  parameters: {
    docs: {
      description: {
        story:
          'Shows real rows for open changes-requested/failed CI, a draft with pending checks, and a merged pull request. Select rows or use the actions menu to add an item to the local thread-selection summary. External links are intercepted.',
      },
    },
  },
}

export const DetailStatusAndStack: Story = {
  render: () => withFixture(<PullDetailBlocks />),
  parameters: {
    docs: {
      description: {
        story:
          'Shows production PullStatus, its ReviewBadge states, check outputs and annotations, plus PullStack with local select/create/update feedback. All status, comments, checks, and stack data are schema-decoded fixtures; links do not navigate.',
      },
    },
  },
}

export const PipelineRunsDisconnected: Story = {
  render: () => (
    <ComposerFixtureProvider>
      <OfflinePipelineExample />
    </ComposerFixtureProvider>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Production PullPipelineRuns in its disconnected empty state. The fixture disconnects before mounting the component, so refresh/read requests are not issued. Connect to the task’s computer is shown as the required next action.',
      },
    },
  },
}
