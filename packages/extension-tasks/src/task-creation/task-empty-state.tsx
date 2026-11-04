import { Button } from '@dovo/studio-ui'
import type { Task } from '@dovo/studio-core'
import { ComposerProject, type SelectRemoteProject } from '../chat/composer/composer-project'

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
    <div
      data-thread-start=""
      className={`flex min-h-0 flex-col items-center justify-center px-5 text-center ${welcome ? 'mt-auto shrink-0 gap-6 pb-6 pt-8' : 'flex-1 gap-2 py-6'}`}
    >
      {welcome && (
        <span className="startup-eyebrow text-xs font-medium tracking-wide text-muted-foreground">
          Your workspace, ready when you are
        </span>
      )}
      <h2
        className={
          welcome
            ? 'startup-heading text-balance text-2xl font-medium tracking-tight sm:text-3xl'
            : 'max-w-xl text-balance text-xl font-medium tracking-tight sm:text-2xl'
        }
      >
        What would you like to work on?
      </h2>
      {welcome && (
        <p className="startup-description max-w-md text-sm leading-relaxed text-muted-foreground">
          Start with an idea, a question, or something you want to build.
        </p>
      )}
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
    </div>
  )
}
