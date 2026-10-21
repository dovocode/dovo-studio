import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { useWorkspace, WorkspaceValueProvider } from '@dovo/studio-core'
import type { CodeFinding, TaskReviewReport } from '../../../packages/protocol/src'
import {
  CodeReviewReport,
  type ReviewTab,
} from '../../../packages/extension-tasks/src/review/code-review-report'
import type { TaskReviewController } from '../../../packages/extension-tasks/src/review/use-task-review'
import { PipelineSectionStatus } from '../../../packages/extension-scm/src/work/pipeline-section-status'
import { ComposerFixtureProvider, useComposerFixture } from './composer-fixture'

const meta = {
  title: 'Dovo/Reviews and checks',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Review and check status examples use production components with local fixture data. Refresh actions update only story state and never contact a forge or change a repository.',
      },
    },
  },
} satisfies Meta
export default meta

function LocalReviewWorkspace({ children }: { children: ReactNode }) {
  const context = useWorkspace()
  return (
    <WorkspaceValueProvider
      value={{
        ...context,
        connected: false,
        snapshot: context.snapshot ? { ...context.snapshot, codeReviewsEnabled: true } : null,
      }}
    >
      {children}
    </WorkspaceValueProvider>
  )
}

const now = '2026-10-21T10:20:00.000Z'
const findings: CodeFinding[] = [
  {
    id: 'finding-stale-cache',
    path: 'apps/web/src/cache.ts',
    line: 84,
    severity: 'high',
    title: 'A failed refresh can leave the previous user’s cached data visible',
    trigger: 'Switch accounts while the background refresh is failing.',
    impact: 'The page can display data from the prior account until another successful refresh.',
    suggestion: 'Clear account-scoped cache entries before loading the next account.',
    status: 'open',
  },
  {
    id: 'finding-missing-empty',
    path: 'apps/web/src/reviews/list.tsx',
    line: 132,
    severity: 'medium',
    title: 'The empty state is not announced after filtering removes every result',
    trigger: 'Enter a search query that matches no findings.',
    impact: 'Screen reader users receive no indication that the list is empty.',
    suggestion: 'Render a concise empty-result message in the results region.',
    status: 'addressed',
  },
  {
    id: 'finding-long-copy',
    path: 'packages/extension-tasks/src/review/report.tsx',
    line: 206,
    severity: 'low',
    title:
      'Long provider output needs to wrap inside the review panel so a narrow window remains usable',
    trigger:
      'A provider returns a long unbroken path or diagnostic string while the review panel is narrow.',
    impact:
      'Without wrapping, the evidence can widen the page and hide the finding actions off screen.',
    suggestion:
      'Allow long content to wrap or break at safe boundaries, while keeping file paths selectable.',
    status: 'open',
  },
]

function reviewReport({
  current = true,
  empty = false,
}: { current?: boolean; empty?: boolean } = {}): TaskReviewReport {
  return {
    current,
    approved: false,
    evidenceLimited: false,
    commands: [],
    reviews: [
      {
        id: 'review-2026-10-21',
        taskId: 'preview-task',
        reviewer: 'Read-only reviewer',
        model: 'gpt-6.1-sol',
        createdAt: now,
        finishedAt: now,
        status: 'completed',
        scope: 'working',
        baseline: 'revision-before',
        head: 'revision-reviewed',
        directory: '/workspace/dovo-studio',
        files: [],
        findings: empty ? [] : findings,
        summary: empty
          ? 'No concrete problems were reported in this review.'
          : 'Three findings were reported. One fix was requested; the remaining findings need review.',
        notVerified: ['Mobile behavior was not exercised.'],
      },
    ],
  }
}

function ReviewReport({ stale = false, empty = false }: { stale?: boolean; empty?: boolean }) {
  const { task } = useComposerFixture()
  const [tab, setTab] = useState<ReviewTab>('findings')
  const [action, setAction] = useState('Choose a finding to preview its host callback.')
  const review = {
    report: reviewReport({ current: !stale, empty }),
    busy: false,
    error: '',
    refresh: async () => undefined,
    run: async () => false,
  } satisfies TaskReviewController
  return (
    <div className="flex h-[min(42rem,85vh)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background">
      <CodeReviewReport
        task={{ ...task, status: 'review' }}
        review={review}
        tab={tab}
        onTab={setTab}
        onOpen={(finding) => setAction(`Open ${finding.path}:${finding.line} — ${finding.title}`)}
        onSince={(id) => setAction(`Compare changes since local review ${id}.`)}
      />
      {tab === 'diff' && (
        <p className="p-3 text-xs text-muted-foreground">
          The host review pane owns the diff. This example covers the report controls, findings and
          verification.
        </p>
      )}
      <p role="status" className="border-t p-3 text-xs text-muted-foreground">
        {action}
      </p>
    </div>
  )
}

const withReviewFixture =
  (story: (props: { stale?: boolean; empty?: boolean }) => ReactNode) =>
  (props: { stale?: boolean; empty?: boolean }) => (
    <ComposerFixtureProvider>
      <LocalReviewWorkspace>{story(props)}</LocalReviewWorkspace>
    </ComposerFixtureProvider>
  )

export const ReviewFindings: StoryObj = {
  render: withReviewFixture((props) => <ReviewReport {...props} />),
  parameters: {
    docs: {
      description: {
        story:
          'The production CodeReviewReport renders synthetic high, medium, and low severity findings, including an addressed finding and long evidence text. Review mutations are disabled because the preview has no connected runtime; no reviewer or runtime request is made.',
      },
    },
  },
}

export const ReviewFindingsStale: StoryObj = {
  render: withReviewFixture(() => <ReviewReport stale />),
  parameters: {
    docs: {
      description: {
        story:
          'Shows the production stale-review warning above otherwise valid findings. The fixture makes clear that the reviewed revision moved and the report should not be treated as current.',
      },
    },
  },
}

export const ReviewFindingsEmpty: StoryObj = {
  render: withReviewFixture(() => <ReviewReport empty />),
  parameters: {
    docs: {
      description: {
        story:
          'Shows the production completed-review empty state. This means the reviewer reported no concrete findings; it does not claim that verification commands passed.',
      },
    },
  },
}

export const ChecksLoading: StoryObj = {
  render: () => (
    <section className="grid max-w-2xl gap-3" aria-label="Pipeline checks loading">
      <PipelineSectionStatus
        label="Checks"
        connected
        state={{ ready: false, error: '', busy: true, refresh: () => {} }}
      />
      <p className="text-xs text-muted-foreground">
        The section is still loading. The refresh control stays unavailable while a request is in
        progress.
      </p>
    </section>
  ),
}

function RefreshableChecks({ initial }: { initial: 'stale' | 'error' | 'long-error' }) {
  const [refreshed, setRefreshed] = useState(false)
  const error =
    initial === 'error' && !refreshed
      ? 'The provider could not refresh this check run.'
      : initial === 'long-error' && !refreshed
        ? 'Could not refresh checks for refs/heads/feature/review-findings-and-verification-after-the-forge-provider-reported-an-invalid-or-expired-revision-token. Existing cached results may refer to an earlier revision.'
        : ''
  const ready = initial === 'stale' || refreshed
  return (
    <section className="grid max-w-2xl gap-3" aria-label="Refreshable pipeline checks">
      <PipelineSectionStatus
        label="Checks"
        connected
        state={{
          ready,
          error,
          busy: false,
          detail: initial === 'stale' && !refreshed ? { stale: true } : undefined,
          refresh: () => setRefreshed(true),
        }}
      />
      {refreshed && (
        <p role="status" className="text-xs text-status-success">
          Local preview refreshed the check section.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Refresh changes this example to its local ready state; it sends no request.
      </p>
    </section>
  )
}

export const ChecksCachedAndStale: StoryObj = {
  render: () => <RefreshableChecks initial="stale" />,
}

export const ChecksUnavailable: StoryObj = {
  render: () => (
    <section className="grid max-w-2xl gap-3" aria-label="Pipeline checks unavailable">
      <PipelineSectionStatus
        label="Checks"
        connected={false}
        state={{
          ready: false,
          error: 'The connected forge does not provide check runs for this revision.',
          busy: false,
          refresh: () => {},
        }}
      />
      <p className="text-xs text-muted-foreground">
        Unsupported check data is reported explicitly. It is not presented as a passing or empty
        result.
      </p>
    </section>
  ),
}

export const ChecksLongError: StoryObj = {
  render: () => <RefreshableChecks initial="long-error" />,
}

export const ChecksEmptyReady: StoryObj = {
  render: () => (
    <section className="grid max-w-2xl gap-3" aria-label="No pipeline checks reported">
      <p role="status" className="text-xs text-muted-foreground">
        Checks loaded successfully.
      </p>
      <p className="rounded-lg border bg-card p-3 text-sm">No checks were reported for this run.</p>
      <p className="text-xs text-muted-foreground">
        An empty successful response is distinct from a provider that does not support check data;
        unsupported responses should use the explicit error state above.
      </p>
    </section>
  ),
}
