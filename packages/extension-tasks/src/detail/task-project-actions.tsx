import { useState } from 'react'
import { Hash, LayoutTemplate, Play, Plus, Settings2, Trash2 } from 'lucide-react'
import { TaskTemplatesDialog } from '../dialogs/task-templates-dialog'
import { SavedPromptsDialog } from '../dialogs/saved-prompts-dialog'
import { ProjectInstructionsDialog } from '../dialogs/project-instructions-dialog'
import { canChangeTaskCheckout, type ProjectAction } from '@dovo/protocol'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  IconButton,
  Input,
} from '@dovo/studio-ui'

const item =
  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors duration-150 data-[disabled]:opacity-50 data-[highlighted]:bg-accent/55 motion-reduce:transition-none'

/** One-tap project commands ("Run tests", "Start dev server") in the task's terminal. */
export function TaskProjectActions({
  task,
  onTerminal,
}: {
  task: Task
  onTerminal: (terminalId: string) => void
}) {
  const { workspace, request, connected } = useWorkspace()
  const [editing, setEditing] = useState(false)
  const [prompts, setPrompts] = useState(false)
  const [templates, setTemplates] = useState(false)
  const [rules, setRules] = useState(false)
  const [instructions, setInstructions] = useState(false)
  const [error, setError] = useState('')
  const repository = workspace.repositories.find((item) => item.id === task.repositoryId)
  if (!repository) return null
  const actions = repository.actions ?? []
  // A worktree task gets its checkout with the first message; before that there is nowhere to run.
  const ready = connected && !(task.execution === 'worktree' && canChangeTaskCheckout(task))
  const run = (action: ProjectAction) => {
    setError('')
    void request(
      '/api/terminals/run',
      { taskId: task.id, command: action.command },
      responses.terminal,
    )
      .then((terminal) => onTerminal(terminal.id))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[0.6875rem]"
            title={error || 'Project actions'}
            aria-label="Project actions"
          >
            <Play className="size-3.5" />
            <span className="hidden lg:inline">Actions</span>
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={4}
            align="end"
            className="z-50 min-w-56 max-w-80 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {actions.map((action) => (
              <DropdownMenu.Item
                key={action.id}
                className={item}
                disabled={!ready}
                onSelect={() => run(action)}
              >
                <Play className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{action.name}</span>
                <code className="max-w-32 truncate text-[0.625rem] text-muted-foreground">
                  {action.command.split('\n')[0]}
                </code>
              </DropdownMenu.Item>
            ))}
            {!actions.length && (
              <p className="px-2 py-1.5 text-[0.6875rem] text-muted-foreground">
                No actions for {repository.name} yet.
              </p>
            )}
            {!ready && !!actions.length && (
              <p className="px-2 py-1.5 text-[0.6875rem] text-muted-foreground">
                {connected ? 'Available after the first message.' : 'Connect to run actions.'}
              </p>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item className={item} onSelect={() => setEditing(true)}>
              <Settings2 className="size-3.5" /> Edit project actions…
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} onSelect={() => setPrompts(true)}>
              <Hash className="size-3.5" /> Edit saved prompts…
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} onSelect={() => setTemplates(true)}>
              <LayoutTemplate className="size-3.5" /> Manage task templates…
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} onSelect={() => setRules(true)}>
              <Settings2 className="size-3.5" /> Manage approval rules…
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} onSelect={() => setInstructions(true)}>
              <Settings2 className="size-3.5" /> Edit project instructions…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {templates && (
        <TaskTemplatesDialog repositoryId={repository.id} onClose={() => setTemplates(false)} />
      )}
      {prompts && (
        <SavedPromptsDialog repositoryId={repository.id} onClose={() => setPrompts(false)} />
      )}
      {rules && (
        <ApprovalRulesDialog repositoryId={repository.id} onClose={() => setRules(false)} />
      )}
      {instructions && (
        <ProjectInstructionsDialog
          repositoryId={repository.id}
          onClose={() => setInstructions(false)}
        />
      )}
      {editing && (
        <ProjectActionsDialog
          repositoryId={repository.id}
          name={repository.name}
          actions={actions}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}

function ApprovalRulesDialog({
  repositoryId,
  onClose,
}: {
  repositoryId: string
  onClose: () => void
}) {
  const { workspace, setWorkspace } = useWorkspace()
  const repository = workspace.repositories.find((item) => item.id === repositoryId)
  const rules = repository?.approvedCommands ?? []
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Project approval rules</DialogTitle>
        <DialogDescription>
          These exact commands run without asking again in {repository?.name}.
        </DialogDescription>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {rules.map((command) => (
            <div key={command} className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-muted p-2 text-xs">
                {command}
              </code>
              <IconButton
                label={`Remove approval rule for ${command}`}
                onClick={() =>
                  setWorkspace((current) => ({
                    ...current,
                    repositories: current.repositories.map((item) =>
                      item.id === repositoryId
                        ? { ...item, approvedCommands: rules.filter((rule) => rule !== command) }
                        : item,
                    ),
                  }))
                }
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
          {!rules.length && <p className="text-xs text-muted-foreground">No saved commands.</p>}
        </div>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function ProjectActionsDialog({
  repositoryId,
  name,
  actions,
  onClose,
}: {
  repositoryId: string
  name: string
  actions: ProjectAction[]
  onClose: () => void
}) {
  const { setWorkspace } = useWorkspace()
  const [rows, setRows] = useState<ProjectAction[]>(() =>
    actions.length ? actions : [{ id: crypto.randomUUID(), name: 'Run tests', command: '' }],
  )
  const [error, setError] = useState('')
  const change = (id: string, changes: Partial<ProjectAction>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)))
  const save = () => {
    const cleaned = rows
      .map((row) => ({ ...row, name: row.name.trim(), command: row.command.trim() }))
      .filter((row) => row.name || row.command)
    if (cleaned.some((row) => !row.name || !row.command)) {
      setError('Give every action a name and a command, or remove it.')
      return
    }
    try {
      setWorkspace((workspace) => ({
        ...workspace,
        repositories: workspace.repositories.map((repository) =>
          repository.id === repositoryId
            ? { ...repository, actions: cleaned.length ? cleaned : undefined }
            : repository,
        ),
      }))
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Project actions</DialogTitle>
        <DialogDescription>
          One-click commands for {name}. They run in the task’s terminal, in its checkout.
        </DialogDescription>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {rows.map((row) => (
            <div key={row.id} className="flex items-start gap-2">
              <Input
                aria-label="Action name"
                placeholder="Name"
                value={row.name}
                maxLength={60}
                onChange={(event) => change(row.id, { name: event.target.value })}
                className="h-8 w-36 text-xs"
              />
              <Input
                aria-label="Command"
                placeholder="pnpm test"
                value={row.command}
                maxLength={4000}
                onChange={(event) => change(row.id, { command: event.target.value })}
                className="h-8 flex-1 font-mono text-xs"
              />
              <IconButton
                label="Remove action"
                className="size-8"
                onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-fit gap-1"
          disabled={rows.length >= 20}
          onClick={() =>
            setRows((current) => [...current, { id: crypto.randomUUID(), name: '', command: '' }])
          }
        >
          <Plus className="size-3.5" /> Add action
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
