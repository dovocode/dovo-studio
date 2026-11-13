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
  if (task?.bot)
    return (
      <section
        className="mx-auto grid max-w-xl gap-2 px-6 py-10 text-center"
        aria-label="Bot introduction"
      >
        <h2 className="text-xl font-semibold">{task.title}</h2>
        <p className="text-sm text-muted-foreground">{task.bot.role}</p>
        <p className="text-sm text-muted-foreground">
          Send a message to start working with your Bot.
        </p>
      </section>
    )
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
