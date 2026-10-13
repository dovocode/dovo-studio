import { useEffect, useRef, useState } from 'react'
import { confirmDiscardChanges } from './unsaved-changes'
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
  const [initialRows] = useState(rows)
  const [error, setError] = useState('')
  const [validated, setValidated] = useState(false)
  const [focusId, setFocusId] = useState('')
  const fields = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>())
  const close = () => {
    if (confirmDiscardChanges(JSON.stringify(rows) !== JSON.stringify(initialRows))) onClose()
  }
  const normalizedName = (name: string) => name.trim()
  const issues = new Map<string, string>()
  for (const row of rows) {
    const name = normalizedName(row.name)
    if (
      name &&
      rows.filter((item) => normalizedName(item.name).toLowerCase() === name.toLowerCase()).length >
        1
    )
      issues.set(`${row.id}:name`, 'This name is already used.')
    if (validated && !name) issues.set(`${row.id}:name`, 'Enter a name.')
  }
  useEffect(() => {
    if (!focusId) return
    const field = fields.current.get(focusId)
    field?.focus()
    field?.scrollIntoView({ block: 'nearest' })
    setFocusId('')
  }, [focusId, rows])
  const change = (id: string, changes: Partial<TaskTemplate>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)))
  const save = () => {
    setValidated(true)
    const cleaned = rows.map((row) => ({ ...row, name: row.name.trim() }))
    const unnamed = cleaned.find((row) => !row.name)
    if (unnamed) {
      setFocusId(`${unnamed.id}:name`)
      setError('Give every template a name.')
      return
    }
    const duplicate = cleaned.find(
      (row) =>
        cleaned.filter((item) => item.name.toLowerCase() === row.name.toLowerCase()).length > 1,
    )
    if (duplicate) {
      setFocusId(`${duplicate.id}:name`)
      setError('Each template needs a different name.')
      return
    }
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
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Task templates</DialogTitle>
        <DialogDescription>
          Starting points for new tasks in {repository?.name ?? 'this project'}. Right-click a task
          and choose Save as template to add one.
        </DialogDescription>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {rows.map((row, index) => (
            <div key={row.id} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`Template ${index + 1} name`}
                  ref={(node) => {
                    if (node) fields.current.set(`${row.id}:name`, node)
                    else fields.current.delete(`${row.id}:name`)
                  }}
                  aria-invalid={issues.has(`${row.id}:name`)}
                  aria-describedby={`${row.id}-name-help`}
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
                  label={`Remove template ${index + 1}: ${row.name || 'Untitled'}`}
                  className="size-8"
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              <p
                id={`${row.id}-name-help`}
                className={
                  issues.has(`${row.id}:name`)
                    ? 'text-xs text-destructive'
                    : 'text-xs text-muted-foreground'
                }
              >
                {issues.get(`${row.id}:name`) ?? `${row.name.length}/80 characters`}
              </p>
              <Textarea
                aria-label={`Template ${index + 1} goal`}
                ref={(node) => {
                  if (node) fields.current.set(`${row.id}:objective`, node)
                  else fields.current.delete(`${row.id}:objective`)
                }}
                aria-invalid={issues.has(`${row.id}:objective`)}
                aria-describedby={`${row.id}-text-help`}
                value={row.objective}
                maxLength={20000}
                onChange={(event) => change(row.id, { objective: event.target.value })}
                className="min-h-16 text-xs"
              />
              <p
                id={`${row.id}-text-help`}
                className={
                  issues.has(`${row.id}:objective`)
                    ? 'text-xs text-destructive'
                    : 'text-xs text-muted-foreground'
                }
              >
                {issues.get(`${row.id}:objective`) ??
                  `${row.objective.length.toLocaleString()}/20,000 characters`}
              </p>
            </div>
          ))}
          {!rows.length && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No templates yet. Open a task’s menu and choose “Save as template…” to create your
              first starting point.
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
