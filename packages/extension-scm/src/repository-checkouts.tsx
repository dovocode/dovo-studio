import { ChoicePicker } from '@dovo/studio-ui'
import { useState } from 'react'
import { useWorkspace, type Repository } from '@dovo/studio-core'
import { FormField } from '@dovo/studio-ui'
import { RepositoryActions } from './repository-actions'
export function RepositoryCheckouts({ repo }: { repo: Repository }) {
  const { workspace } = useWorkspace()
  const [taskId, setTaskId] = useState('')
  return (
    <div className="mt-4 space-y-3">
      <FormField label="Working directory">
        <ChoicePicker
          aria-label="Working directory"
          className="h-9 rounded-md border bg-background px-2 text-xs"
          value={taskId}
          onValueChange={(selection) => setTaskId(selection)}
        >
          <option value="">Project checkout</option>
          {workspace.tasks
            .filter((t) => t.repositoryId === repo.id && t.execution === 'worktree')
            .map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · worktree
              </option>
            ))}
        </ChoicePicker>
      </FormField>
      <RepositoryActions key={taskId} repo={repo} taskId={taskId || undefined} />
    </div>
  )
}
