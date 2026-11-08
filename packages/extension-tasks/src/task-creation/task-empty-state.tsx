import { Button } from '@dovo/studio-ui'
import type { Task } from '@dovo/studio-core'
import { ComposerProject, type SelectRemoteProject } from '../chat/composer/composer-project'
import { StartupHeading } from './startup-heading'

export function TaskEmptyState({
  onBrowse,
  projectName,
  welcome = false,
  task,
  disabled = false,
  onMoving,
  onSelectRemote,
}: {
  onBrowse?: () => void
  projectName?: string
  welcome?: boolean
  task?: Task
  disabled?: boolean
  onMoving?: (moving: boolean) => void
  onSelectRemote?: SelectRemoteProject
}) {
  return (
    <StartupHeading data-thread-start="" welcome={welcome}>
      {projectName && !task && <p className="text-xs text-muted-foreground">In {projectName}</p>}
      {task && (
        <ComposerProject
          task={task}
          prominent
          controls="project"
          disabled={disabled}
          onMoving={onMoving}
          onSelectRemote={onSelectRemote}
        />
      )}
      {onBrowse && (
        <Button variant="ghost" size="sm" onClick={onBrowse} className="text-muted-foreground">
          Browse threads
        </Button>
      )}
    </StartupHeading>
  )
}
