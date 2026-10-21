import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PageHeader } from '../../../packages/studio-ui/src/page-header'
import { EmptyState } from '../../../packages/studio-ui/src/components/empty-state'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'

const meta = {
  title: 'Dovo/Build screens',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Composition recipes using production controls. Start from the existing product pattern; keep state, navigation and authorization with its owner. These examples simulate local screen state only.',
      },
    },
  },
} satisfies Meta
export default meta

const components = [
  [
    'Desktop pages and sidebars',
    'Screens / Desktop and Desktop detail and overlays',
    'packages/studio-shell and packages/extension-*',
    'Compare the whole page before changing a component: navigation, title, list selection, detail and tools rail. The catalog imports every registered page; synthetic reads and blocked mutations keep review separate from a live workspace.',
  ],
  [
    'Mobile pages and native navigation',
    'Screens / Mobile and native Storybook / Native navigation',
    'apps/mobile/src/screens and apps/mobile/src/shell',
    'Use browser stories for responsive content and the native catalog for actual tabs, stacks, menus and keyboard behavior. Full composer stories include attachments, provider controls and queued messages; recognition and uploads require separate verification.',
  ],
  [
    'Auth, Connect, Artifacts and website',
    'Screens / Hosted',
    'apps/auth-server, apps/connect-server, apps/artifact-server and apps/site',
    'Reuse the production page owners and semantic tokens. Hosted previews run inside isolated frames with synthetic identities and responses; a sign-in preview does not perform real authentication.',
  ],
  [
    'Mobile controls and settings',
    'Field / Action / SettingsGroup / SettingsRow',
    'apps/mobile/src/ui and apps/mobile/src/screens/settings-*',
    'Reuse native component owners. Group related settings, preserve drafts on save failure, and keep confirmation separate from navigation. Browser previews use React Native Web; native menus, keyboard and gestures still need device review.',
  ],
  [
    'Mobile conversation inputs',
    'ComposerField / QuestionField',
    'apps/mobile/src/tasks/composer',
    'Draft editing and question choice semantics stay in production controls. Sending and permission decisions belong to the feature; catalog examples simulate local outcomes only.',
  ],
  [
    'Forge PR browsing and details',
    'PullRow / PullStatus / PullStack',
    'packages/extension-scm/src/pulls',
    'Reuse row selection and menus; keep checks, reviewer decisions and mergeability distinct. Stacks preserve dependency order and contextual actions.',
  ],
  [
    'Thread navigation',
    'TaskRow',
    'packages/extension-tasks/src/list/task-row.tsx',
    'Identity, status, unread activity, runtime/project metadata and nested threads. Keep lifecycle actions separate from opening the thread.',
  ],
  [
    'Dense thread selection',
    'TaskListRow',
    'packages/extension-tasks/src/list/task-list-row.tsx',
    'Use the existing list row for virtualized lists and bulk selection; do not turn an entire row into a button containing other buttons.',
  ],
  [
    'Linked pull request',
    'TaskPullStatus / TaskLinkedPullPanel',
    'packages/extension-tasks/src/detail',
    'Use one source of truth for draft/open/merged/closed status and checks. Keep retry/fix actions local to the failing item.',
  ],
  [
    'Review findings',
    'CodeReviewCard / CodeReviewReport',
    'packages/extension-tasks/src/review',
    'Preserve severity, file/line context and actionable finding text. Color supports labels; it does not replace them.',
  ],
  [
    'Conversation and follow-ups',
    'ChatMessage / MessageQueue / Composer',
    'packages/extension-tasks/src/chat',
    'Compose production message, tool, queue and editor components. Keep drafts on failures; distinguish saved, queued and sent.',
  ],
  [
    'Page identity and empty content',
    'PageHeader / EmptyState',
    'packages/studio-ui/src',
    'One page title, concise description, one primary action. Put filters below identity and contextual actions beside their content.',
  ],
] as const

export const ComponentMap: StoryObj = {
  render: () => (
    <article className="max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Build from the product patterns</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use the thread, pull request, review and composer stories as living references. Import
          their production owners; do not copy catalog fixture markup into the app.
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        {components.map(([purpose, component, source, rule]) => (
          <section key={purpose} className="min-w-0 rounded-xl border bg-card p-4">
            <h2 className="text-sm font-semibold">{purpose}</h2>
            <p className="mt-2 break-words font-mono text-xs">{component}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">{source}</p>
            <p className="mt-3 text-sm leading-relaxed">{rule}</p>
          </section>
        ))}
      </div>
      <section className="rounded-xl border p-4 text-sm">
        <h2 className="font-semibold">Before adding another component</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>Choose the existing product pattern and identify who owns its state and actions.</li>
          <li>
            Reuse semantic tokens and polished Button variants. Reserve destructive styling for
            destructive actions.
          </li>
          <li>
            Keep title, status, secondary metadata and actions in that order; adapt layout without
            changing meaning.
          </li>
          <li>
            Demonstrate long content, missing metadata, loading, failure, disconnected and selected
            states where relevant.
          </li>
          <li>
            Check both themes, keyboard focus, 390px layout and real touch targets. Native text
            scaling still needs device verification.
          </li>
        </ol>
      </section>
    </article>
  ),
}

type PreviewState = 'loading' | 'empty' | 'error' | 'ready'
function ScreenStateRecipe() {
  const [state, setState] = useState<PreviewState>('empty')
  return (
    <section className="max-w-4xl space-y-4">
      <div role="group" aria-label="Screen preview state" className="flex flex-wrap gap-2">
        {(['loading', 'empty', 'error', 'ready'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={state === value ? 'secondary' : 'outline'}
            aria-pressed={state === value}
            onClick={() => setState(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border bg-background">
        <PageHeader
          embedded
          title="Threads"
          description="Conversations and changes for this project."
        >
          <Button disabled={state === 'loading'} onClick={() => setState('ready')}>
            New thread
          </Button>
        </PageHeader>
        <div className="min-h-60 p-4" aria-busy={state === 'loading'}>
          {state === 'loading' && (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              Loading threads…
            </p>
          )}
          {state === 'empty' && (
            <EmptyState
              title="No threads yet"
              description="Start a conversation to keep its work and changes together."
              action={
                <Button variant="outline" onClick={() => setState('ready')}>
                  Start a thread
                </Button>
              }
            />
          )}
          {state === 'error' && (
            <div className="space-y-3 rounded-lg border p-4">
              <p role="alert" className="text-sm text-destructive">
                Threads could not be loaded. Your existing work is preserved.
              </p>
              <Button variant="outline" onClick={() => setState('ready')}>
                Retry loading threads
              </Button>
            </div>
          )}
          {state === 'ready' && (
            <div role="status" className="space-y-2 rounded-lg border bg-card p-4">
              <p className="text-sm font-medium">Local example ready</p>
              <p className="text-sm text-muted-foreground">
                No thread was created. Use the Thread cards and lists stories for real production
                rows and selection behavior.
              </p>
            </div>
          )}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Recipe ownership: PageHeader and EmptyState are production components. The screen state and
        retry are local simulations. Keep data-fetching, permissions and navigation in the feature,
        rather than adding them to visual primitives.
      </p>
    </section>
  )
}
export const ScreenStatesAndActions: StoryObj = {
  render: () => <ScreenStateRecipe />,
  parameters: {
    docs: {
      description: {
        story:
          'Use the same page identity and action hierarchy while content changes state. Loading announces progress, errors preserve context and expose a named retry, and empty states explain the next step. New thread is a page action; Retry belongs to the error. All actions affect this example only.',
      },
    },
  },
}
