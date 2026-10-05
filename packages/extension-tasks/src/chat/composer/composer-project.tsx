import {
  canChangeTaskCheckout,
  resolveTaskDefaults,
  updateTask,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { Button, Input, Popover } from '@dovo/studio-ui'
import { RepositoryDialog } from '@dovo/extension-scm/repository-dialog'
import { Check, ChevronDown, Folder, Github, Link, MessageCircle } from 'lucide-react'
import { useState } from 'react'

export function ComposerProject({ task, disabled }: { task: Task; disabled: boolean }) {
  const { workspace, setWorkspace, snapshot } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<'local' | 'github' | 'forge' | null>(null)
  const repository = workspace.repositories.find((item) => item.id === task.repositoryId)
  if (!canChangeTaskCheckout(task) || task.pullRequest || task.workItem) return null
  const locked = disabled || !!task.draftAttachments?.length
  const choose = (id: string) => {
    const target = workspace.repositories.find((item) => item.id === id)
    if (!target || locked || target.gitIdentityError) return
    setWorkspace((current) =>
      updateTask(current, task.id, (draft) => ({
        ...draft,
        ...resolveTaskDefaults(snapshot?.defaults, target),
        repositoryId: target.id,
        agentId: '',
        agentOverrides: undefined,
        existingWorktreePath: undefined,
        worktreeBaseBranch: undefined,
      })),
    )
    setOpen(false)
  }
  const matches = workspace.repositories.filter((item) =>
    `${item.kind === 'scratch' ? 'Chat' : item.name} ${item.path}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (value) setQuery('')
        }}
      >
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            disabled={locked}
            aria-label="Task project"
            className="h-7 min-w-0 gap-1.5 rounded-lg bg-muted/50 px-2 text-xs font-normal"
          >
            {repository?.kind === 'scratch' ? (
              <MessageCircle className="size-3.5" />
            ) : (
              <Folder className="size-3.5" />
            )}
            <span className="max-w-40 truncate">
              {repository?.kind === 'scratch' ? 'Chat' : (repository?.name ?? 'Choose folder')}
            </span>
            <ChevronDown className="size-3" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            aria-label="Choose folder"
            className="z-50 w-80 rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
          >
            <Input
              aria-label="Search folders"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mb-2"
            />
            <div className="max-h-64 overflow-y-auto">
              {matches.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  disabled={!!item.gitIdentityError}
                  title={item.gitIdentityError || item.path}
                  aria-pressed={item.id === task.repositoryId}
                  className="h-10 w-full justify-start gap-2 text-sm font-normal aria-pressed:bg-accent"
                  onClick={() => choose(item.id)}
                >
                  <span className="w-4">
                    {item.id === task.repositoryId && <Check className="size-4" />}
                  </span>
                  {item.kind === 'scratch' ? (
                    <MessageCircle className="size-4 shrink-0" />
                  ) : (
                    <Folder className="size-4 shrink-0" />
                  )}
                  <span className="truncate">{item.kind === 'scratch' ? 'Chat' : item.name}</span>
                </Button>
              ))}
              {!matches.length && (
                <p className="p-3 text-xs text-muted-foreground">No matching folders.</p>
              )}
            </div>
            <div className="mt-2 border-t pt-2">
              {(
                [
                  ['github', Github, 'Add GitHub repository'],
                  ['forge', Link, 'Clone repository'],
                  ['local', Folder, 'Open folder'],
                ] as const
              ).map(([source, Icon, label]) => (
                <Button
                  key={source}
                  variant="ghost"
                  className="h-10 w-full justify-start gap-2 pl-8 text-sm font-normal"
                  onClick={() => {
                    setOpen(false)
                    setAdding(source)
                  }}
                >
                  <Icon className="size-4" />
                  {label}
                </Button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {adding && (
        <RepositoryDialog
          projectLabels
          initialSource={adding}
          onClose={() => {
            setAdding(null)
            setOpen(true)
          }}
        />
      )}
    </>
  )
}
