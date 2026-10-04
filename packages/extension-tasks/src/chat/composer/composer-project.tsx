import {
  canChangeTaskCheckout,
  resolveTaskDefaults,
  updateTask,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { Folder } from 'lucide-react'

export function ComposerProject({ task, disabled }: { task: Task; disabled: boolean }) {
  const { workspace, setWorkspace, snapshot } = useWorkspace()
  if (!canChangeTaskCheckout(task) || task.pullRequest || task.workItem) return null
  return (
    <label className="inline-flex min-w-0 items-center gap-1.5 text-[0.625rem]">
      <Folder className="size-3 shrink-0" />
      <select
        aria-label="Task project"
        className="max-w-40 bg-transparent"
        value={task.repositoryId}
        disabled={disabled || !!task.draftAttachments?.length}
        onChange={(event) => {
          const repository = workspace.repositories.find((item) => item.id === event.target.value)
          if (!repository) return
          setWorkspace((current) =>
            updateTask(current, task.id, (draft) => ({
              ...draft,
              ...resolveTaskDefaults(snapshot?.defaults, repository),
              repositoryId: repository.id,
              agentId: '',
              agentOverrides: undefined,
              existingWorktreePath: undefined,
              worktreeBaseBranch: undefined,
            })),
          )
        }}
      >
        {workspace.repositories.map((repository) => (
          <option
            key={repository.id}
            value={repository.id}
            disabled={!!repository.gitIdentityError}
          >
            {repository.kind === 'scratch' ? 'Temporary task' : repository.name}
          </option>
        ))}
      </select>
    </label>
  )
}
