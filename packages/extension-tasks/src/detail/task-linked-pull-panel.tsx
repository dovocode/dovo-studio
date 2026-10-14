import { useState } from 'react'
import { GitPullRequest, X } from 'lucide-react'
import { useWorkspace, type Task } from '@dovo/studio-core'
import { Button, IconButton } from '@dovo/studio-ui'
import { taskPullLinks } from './task-pull-links'
import { TaskPullStatus } from './task-pull-status'
import { TaskPullLinkDialog } from '../dialogs/task-pull-link-dialog'

export function TaskLinkedPullPanel({
  task,
  onPullLink,
  onClose,
}: {
  task: Task
  onPullLink: (url: string) => boolean
  onClose: () => void
}) {
  const { connected } = useWorkspace()
  const [linking, setLinking] = useState(false)
  const pulls = taskPullLinks(task)
  return (
    <section
      aria-label="Thread pull requests"
      className="studio-side-panel flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <GitPullRequest size={15} />
        <h2 className="min-w-0 flex-1 truncate">Linked pull requests</h2>
        <span className="text-muted-foreground">{pulls.length}</span>
        <IconButton label="Close linked pull requests" className="size-7" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {pulls.map((pull) => (
          <div key={pull.url} className="studio-project-card p-3">
            {task.pullStatus?.url === pull.url ? (
              <TaskPullStatus task={task} panel title={pull.title} onPullLink={onPullLink} />
            ) : (
              <a
                href={pull.url}
                target="_blank"
                rel="noopener noreferrer"
                className="studio-project-row studio-project-pull"
                title={pull.title}
                onClick={(event) => {
                  if (onPullLink(pull.url)) event.preventDefault()
                }}
              >
                <GitPullRequest size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{pull.title}</span>
                  <span className="mt-1.5 block text-xs text-muted-foreground">#{pull.number}</span>
                </span>
              </a>
            )}
            <p
              className="truncate pl-[34px] text-[11px] text-muted-foreground"
              title={pull.repositoryUrl}
            >
              {pull.repositoryUrl.replace(/^https?:\/\//, '')}
            </p>
          </div>
        ))}
        {!pulls.length && (
          <p className="py-4 text-xs text-muted-foreground">
            No pull requests linked to this thread.
          </p>
        )}
        <Button variant="ghost" size="sm" disabled={!connected} onClick={() => setLinking(true)}>
          Manage linked pull requests
        </Button>
      </div>
      {linking && <TaskPullLinkDialog task={task} onClose={() => setLinking(false)} />}
    </section>
  )
}
