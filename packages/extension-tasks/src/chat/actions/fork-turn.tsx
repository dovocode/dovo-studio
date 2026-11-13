import { useState } from 'react'
import { Schema } from 'effect'
import { GitBranchPlus, RotateCcw } from 'lucide-react'
import { botResultSchema, mutableStruct, taskIsWorking } from '@dovo/protocol'
import { useConfirmation, useStudioHost, useWorkspace } from '@dovo/studio-core'
import { MessageAction } from '@dovo/studio-ui'

const forkSchema = mutableStruct({ id: Schema.String })

/** Starts a new task from this point in the conversation, with this turn's files. */
export function ForkTurn({ taskId, turnId }: { taskId: string; turnId: string }) {
  const { request, connected, workspace, snapshot } = useWorkspace()
  const confirm = useConfirmation()
  const task = workspace.tasks.find((task) => task.id === taskId)
  const host = useStudioHost()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (task?.bot)
    return (
      <span className="inline-flex items-center gap-1" data-studio-human-only>
        <MessageAction
          label="Reset context to here"
          className="size-6 text-muted-foreground"
          disabled={
            !connected ||
            busy ||
            !snapshot?.botContextResetSupported ||
            taskIsWorking(task) ||
            !!task.queue?.length
          }
          onClick={() => {
            void (async () => {
              if (!task.bot || busy) return
              if (
                !(await confirm({
                  title: 'Reset Bot context to this reply?',
                  description:
                    'Future replies will use the conversation up to this point. Later messages stay visible for reference. Files and completed actions stay unchanged.',
                  confirmLabel: 'Reset context',
                }))
              )
                return
              setBusy(true)
              setError('')
              try {
                await request(
                  '/api/bots/reset-context',
                  { id: taskId, turnId, expectedRevision: task.bot.revision },
                  botResultSchema,
                )
              } catch (error) {
                setError(error instanceof Error ? error.message : String(error))
              } finally {
                setBusy(false)
              }
            })()
          }}
        >
          <RotateCcw size={12} />
        </MessageAction>
        {task.bot.contextResets?.some((reset) => reset.turnId === turnId) && (
          <span className="text-[0.625rem] text-muted-foreground">Context reset here</span>
        )}
        {error && (
          <span role="alert" className="text-[0.625rem] text-destructive">
            {error}
          </span>
        )}
      </span>
    )
  return (
    <>
      <MessageAction
        label="Fork from here: a new thread with this conversation and this turn’s files"
        className="size-6 text-muted-foreground"
        disabled={!connected || busy}
        onClick={() => {
          setBusy(true)
          setError('')
          void request('/api/tasks/fork', { id: taskId, turnId }, forkSchema)
            .then((fork) => host.navigate({ viewId: 'tasks', entityId: fork.id }))
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setBusy(false))
        }}
      >
        <GitBranchPlus size={12} />
      </MessageAction>
      {error && (
        <span role="alert" className="text-[0.625rem] text-destructive">
          {error}
        </span>
      )}
    </>
  )
}
