import { useState } from 'react'
import { GitBranchPlus, RotateCcw } from 'lucide-react'
import {
  botResultSchema,
  forkFileDescription,
  forkMessagePreview,
  taskIsWorking,
  turnForkResultSchema,
  type ChatMessage,
  type TaskTurn,
} from '@dovo/protocol'
import { useConfirmation, useStudioHost, useWorkspace } from '@dovo/studio-core'
import { MessageAction } from '@dovo/studio-ui'

export function ForkTurn({
  taskId,
  turn,
  message,
}: {
  taskId: string
  turn: Pick<TaskTurn, 'id' | 'checkpoint'>
  message: ChatMessage
}) {
  const { request, connected, workspace, snapshot } = useWorkspace()
  const confirm = useConfirmation()
  const task = workspace.tasks.find((task) => task.id === taskId)
  const host = useStudioHost()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!task) return null
  const turnId = turn.id
  if (task.bot)
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
  const snapshotTree = turn.checkpoint?.after
  const project = workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const label = snapshotTree ? 'Fork with files from this turn' : 'Fork from this reply'
  const fork = async () => {
    const navigationCurrent = host.taskNavigationGuard?.()
    setBusy(true)
    setError('')
    try {
      const files = forkFileDescription(task.execution, project?.kind, snapshotTree)
      if (
        !(await confirm({
          title: `${label}?`,
          description: `The new thread includes the conversation up to and including this reply. ${snapshotTree ? '' : 'This turn has no saved file snapshot. '}${files}`,
          details: `Selected reply: ${forkMessagePreview(message) || '(No reply text)'}`,
          confirmLabel: 'Fork',
        }))
      )
        return
      const result = await request('/api/tasks/fork', { id: taskId, turnId }, turnForkResultSchema)
      if (!navigationCurrent || navigationCurrent())
        host.navigate({
          viewId: 'tasks',
          entityId: result.id,
          ...(result.messageId ? { messageId: result.messageId } : {}),
        })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <MessageAction
        label={label}
        className="size-6 text-muted-foreground"
        disabled={!connected || busy}
        onClick={() => void fork()}
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
