import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'
import type { Task } from '@dovo/studio-core'
import { ChatMessage } from '../../../packages/extension-tasks/src/chat/thread/chat-message'
import { MessageQueue } from '../../../packages/extension-tasks/src/chat/thread/message-queue'
import { recentTools } from '../../../packages/protocol/src/automation/activity'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'
import { useWorkspace } from '@dovo/studio-core'
import { ComposerFixtureProvider, useComposerFixture } from './composer-fixture'

const meta = {
  title: 'Dovo/Patterns/Task conversation',
  tags: ['autodocs'],
} satisfies Meta
export default meta

const story = (description: string) => ({
  docs: { description: { story: description } },
})

function PreviewRequestLog() {
  const { requests } = useComposerFixture()
  return (
    <details className="mt-3 rounded-lg border bg-muted/20 p-3 text-xs">
      <summary className="cursor-pointer font-medium">
        Local preview requests ({requests.length})
      </summary>
      <p className="my-2 text-muted-foreground">
        Requests are handled in memory. Steering is intentionally unsupported and reports an
        explicit failure.
      </p>
      {requests.length ? (
        <ol className="grid gap-1 font-mono">
          {requests.map((request, index) => (
            <li key={`${index}-${request.path}`} className="break-all">
              {request.path} · {request.outcome}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">No requests yet.</p>
      )}
    </details>
  )
}

function QueueExample() {
  const { task } = useComposerFixture()
  const [pendingState, setPendingState] = useState<'sending' | 'saved' | 'failed' | null>('failed')
  const pendingMessage = task.queue?.find((message) => message.id === 'preview-queued-message-1')
  const pending =
    pendingState && pendingMessage
      ? [
          {
            taskId: task.id,
            message: pendingMessage,
            state: pendingState,
            destination: 'queue' as const,
          },
        ]
      : []
  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Queued follow-ups</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The real queue component edits, reorders, pauses, and restores these local messages.
          </p>
        </div>
        <div role="group" aria-label="Pending delivery state" className="flex flex-wrap gap-2">
          {(['sending', 'saved', 'failed', null] as const).map((state) => (
            <Button
              key={state ?? 'confirmed'}
              size="sm"
              variant={pendingState === state ? 'secondary' : 'outline'}
              aria-pressed={pendingState === state}
              onClick={() => setPendingState(state)}
            >
              {state ?? 'Confirmed'}
            </Button>
          ))}
        </div>
      </header>
      <MessageQueue task={task} pending={pending} />
      <p className="mt-4 text-xs text-muted-foreground">
        Try editing a message, moving the other item, pausing the queue, or selecting steer to see
        the preview-only failure.
      </p>
      <PreviewRequestLog />
    </section>
  )
}

function QueueStory() {
  const [revision, setRevision] = useState(0)
  return (
    <div className="[--chat-max:48rem] p-1">
      <div className="mx-auto mb-3 flex max-w-3xl justify-end">
        <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Reset queue preview
        </Button>
      </div>
      <ComposerFixtureProvider key={revision}>
        <QueueExample />
      </ComposerFixtureProvider>
    </div>
  )
}

export const EditableQueuedFollowUps: StoryObj = {
  render: () => <QueueStory />,
  parameters: story(
    'Mounts the production MessageQueue with synthetic task data and an in-memory workspace adapter. Edit and reorder confirmed items, pause or resume the queue, and switch a queued delivery through sending/saved/failed states. Steering is explicitly unsupported and visible in both the component error and request log; reset restores the initial queue.',
  ),
}

function syntheticTools() {
  const event: Parameters<typeof recentTools>[0][number] = {
    id: 'preview-tool-result',
    time: '2026-10-21T10:01:30.000Z',
    kind: 'tool',
    scope: 'preview-task',
    summary: 'pnpm test --filter landing-page',
    payload: JSON.stringify({
      turnId: 'preview-turn',
      messageId: 'preview-assistant-message',
      toolId: 'preview-test-command',
      status: 'completed',
      textOffset: 47,
      presentation: {
        title: 'pnpm test --filter landing-page',
        input: 'pnpm test --filter landing-page',
        output: '48 checks passed. No snapshots changed.',
        kind: 'command',
      },
    }),
  }
  return recentTools([event])
}

function ConversationExample() {
  const { task } = useComposerFixture()
  const { connected, request } = useWorkspace()
  const tools = useMemo(syntheticTools, [])
  const userMessage: Task['messages'][number] = {
    ...task.messages[0]!,
    text: 'Please use the screenshot to check the spacing and keep the project accent.',
    attachments: task.draftAttachments,
  }
  const assistantMessage: Task['messages'][number] = {
    ...task.messages[1]!,
    text: 'I tightened the page spacing and kept the existing blue accent. The test suite is green. The mobile layout now keeps its main action visible.',
  }
  const pendingMessage = task.queue?.find((message) => message.id === 'preview-queued-message-1')
  const pending = pendingMessage
    ? [
        {
          taskId: task.id,
          message: pendingMessage,
          state: 'saved' as const,
          destination: 'queue' as const,
        },
      ]
    : []
  return (
    <main className="mx-auto flex min-h-[32rem] max-w-4xl [--chat-max:48rem] flex-col justify-end gap-5 rounded-xl border bg-background p-4 sm:p-6">
      <header className="border-b pb-3">
        <p className="text-xs font-medium text-muted-foreground">
          Dovo Studio · Dovo Studio project · Working
        </p>
        <h2 className="mt-1 text-base font-semibold">Improve the project landing page</h2>
      </header>
      <ChatMessage
        taskId={task.id}
        message={userMessage}
        tools={[]}
        compactions={[]}
        highlighted={false}
        pending={null}
        taskRunning
        connected={connected}
        request={request}
      />
      <ChatMessage
        taskId={task.id}
        message={assistantMessage}
        tools={tools}
        compactions={[]}
        highlighted={false}
        pending={null}
        taskRunning
        connected={connected}
        request={request}
      />
      <MessageQueue task={task} pending={pending} />
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Composer preview omitted here; the follow-up queue is interactive above. Attachment preview
        is served from synthetic in-memory bytes.
      </div>
      <PreviewRequestLog />
    </main>
  )
}

export const ConversationWithAttachmentsAndToolResult: StoryObj = {
  render: () => (
    <ComposerFixtureProvider>
      <ConversationExample />
    </ComposerFixtureProvider>
  ),
  parameters: story(
    'Combines production ChatMessage, MessageAttachments, TaskMessageResponse, TaskActivity, and MessageQueue using a small local provider adapter. The user screenshot opens from synthetic bytes; the assistant command result is generated through the real recentTools and thread timeline path; one saved follow-up appears above the composer boundary. No runtime network or artifact publication is used.',
  ),
}
