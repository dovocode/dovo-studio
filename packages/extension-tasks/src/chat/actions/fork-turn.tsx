import { useState } from 'react'
import { Schema } from 'effect'
import { GitBranchPlus } from 'lucide-react'
import { mutableStruct } from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { MessageAction } from '@dovo/studio-ui'

const forkSchema = mutableStruct({ id: Schema.String })

/** Starts a new task from this point in the conversation, with this turn's files. */
export function ForkTurn({ taskId, turnId }: { taskId: string; turnId: string }) {
  const { request, connected } = useWorkspace()
  const host = useStudioHost()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <>
      <MessageAction
        label="Fork from here: a new task with this conversation and this turn’s files"
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
