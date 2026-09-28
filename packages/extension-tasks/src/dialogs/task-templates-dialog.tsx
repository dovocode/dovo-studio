import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { TaskTemplate } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  Textarea,
} from '@dovo/studio-ui'

/** Renames, edits or removes a project's task templates. Create them with "Save as template…"
 * on a task. */
export function TaskTemplatesDialog({
  repositoryId,
  onClose,
}: {
  repositoryId: string
  onClose: () => void
}) {
  const { workspace, setWorkspace } = useWorkspace()
  const repository = workspace.repositories.find((item) => item.id === repositoryId)
  const [rows, setRows] = useState<TaskTemplate[]>(() => repository?.templates ?? [])
  const [error, setError] = useState('')
  const change = (id: string, changes: Partial<TaskTemplate>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)))
  const save = () => {
    const cleaned = rows.map((row) => ({ ...row, name: row.name.trim() }))
    if (cleaned.some((row) => !row.name)) return setError('Give every template a name.')
    if (new Set(cleaned.map((row) => row.name.toLowerCase())).size !== cleaned.length)
      return setError('Each template needs a different name.')
    try {
      setWorkspace((current) => ({
        ...current,
        repositories: current.repositories.map((item) =>
          item.id === repositoryId
            ? { ...item, templates: cleaned.length ? cleaned : undefined }
            : item,
        ),
      }))
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Task templates</DialogTitle>
        <DialogDescription>
          Starting points for new tasks in {repository?.name ?? 'this project'}. Right-click a task
          and choose Save as template to add one.
        </DialogDescription>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {rows.map((row) => (
            <div key={row.id} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Template name"
                  value={row.name}
                  maxLength={80}
                  onChange={(event) => change(row.id, { name: event.target.value })}
                  className="h-8 flex-1 text-xs"
                />
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                  {row.execution === 'worktree' ? 'Worktree' : 'Project folder'}
                  {row.harness ? ` · ${row.harness.provider}` : ''}
                </span>
                <IconButton
                  label="Remove template"
                  className="size-8"
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              <Textarea
                aria-label="Template goal"
                value={row.objective}
                maxLength={20000}
                onChange={(event) => change(row.id, { objective: event.target.value })}
                className="min-h-16 text-xs"
              />
            </div>
          ))}
          {!rows.length && (
            <p className="py-6 text-center text-xs text-muted-foreground">No templates yet.</p>
          )}
        </div>
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
