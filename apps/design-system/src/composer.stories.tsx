import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Composer } from '../../../packages/extension-tasks/src/chat/composer/composer'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'
import { ComposerFixtureProvider, useComposerFixture } from './composer-fixture'

const meta = {
  title: 'Dovo/Composers/Production task composer',
  tags: ['autodocs'],
} satisfies Meta
export default meta

const story = (description: string) => ({ docs: { description: { story: description } } })

function ComposerExample() {
  const { task, requests, setTask, setFailNextRequest, setConnected } = useComposerFixture()
  const [pendingState, setPendingState] = useState<string>('No message is in flight.')
  const setStatus = (status: 'done' | 'running') =>
    setTask((current) => ({
      ...current,
      status,
      activeRunId: status === 'running' ? 'preview-run' : undefined,
    }))
  const setNewTask = () =>
    setTask((current) => ({
      ...current,
      title: 'New design task',
      status: 'draft',
      activeRunId: undefined,
      messages: [],
      turns: [],
      queue: [],
      queuePaused: false,
      draft: '',
    }))
  return (
    <section
      className="grid gap-4 rounded-xl border bg-background p-4 text-foreground"
      style={{ ['--chat-max' as string]: '56rem' }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{task.title}</h2>
          <p className="text-xs text-muted-foreground">
            Production Composer · {task.status === 'running' ? 'Agent running' : 'Follow-up ready'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Composer preview states">
          <Button
            size="sm"
            variant={
              task.status === 'draft' && task.messages.length === 0 ? 'secondary' : 'outline'
            }
            onClick={setNewTask}
          >
            New task
          </Button>
          <Button
            size="sm"
            variant={task.status === 'done' ? 'secondary' : 'outline'}
            onClick={() => setStatus('done')}
          >
            Idle task
          </Button>
          <Button
            size="sm"
            variant={task.status === 'running' ? 'secondary' : 'outline'}
            onClick={() => setStatus('running')}
          >
            Running task
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConnected(false)}>
            Disconnect
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConnected(true)}>
            Reconnect
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setTask((current) => ({
                ...current,
                draft: `${current.draft}${current.draft ? '\n\n' : ''}${'A detailed local preview draft showing how the production editor grows with longer content. '.repeat(12)}`,
              }))
            }
          >
            Long draft
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFailNextRequest(true)}>
            Fail next send
          </Button>
        </div>
      </header>
      <p className="text-xs text-muted-foreground">
        Local simulation: preview or remove the included attachment. Uploads, image edits and branch
        changes report an explicit unsupported action; no files or servers are changed.
      </p>
      <Composer
        task={task}
        onPending={(pending) =>
          setPendingState(
            pending ? `${pending.state} · ${pending.destination}` : 'No message is in flight.',
          )
        }
      />
      <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pendingState}
        </p>
        <details className="max-w-full text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Local preview requests ({requests.length})
          </summary>
          <ol className="mt-2 grid max-h-40 gap-1 overflow-auto rounded-md bg-muted/30 p-2 font-mono">
            {requests.length ? (
              requests.map((request, index) => (
                <li key={`${request.path}-${index}`}>
                  {request.path} · {request.outcome}
                </li>
              ))
            ) : (
              <li>No local requests yet.</li>
            )}
          </ol>
        </details>
      </div>
    </section>
  )
}

function WithFixture() {
  return (
    <ComposerFixtureProvider>
      <ComposerExample />
    </ComposerFixtureProvider>
  )
}

export const FullProductionComposer: StoryObj = {
  render: () => <WithFixture />,
  parameters: story(
    'Renders the production extension-tasks Composer with its real editor, attachment controls, harness/model settings, turn settings, context meter, send/stop actions, and project/worktree controls. The preview task, workspace, runtime snapshot, and request routes are synthetic local state. Use Idle task or Running task to compare follow-up behavior; Long draft and Fail next send exercise editor growth and inline error handling.',
  ),
}
