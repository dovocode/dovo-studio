import { randomUUID } from '@dovo/protocol'
import { useEffect, useRef, useState } from 'react'
import { confirmDiscardChanges } from './unsaved-changes'
import { Plus, Trash2 } from 'lucide-react'
import type { SavedPrompt } from '@dovo/protocol'
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

/** Edits a project's saved prompts, which anyone on its computer can insert with "#name". */
export function SavedPromptsDialog({
  repositoryId,
  onClose,
}: {
  repositoryId: string
  onClose: () => void
}) {
  const { workspace, setWorkspace } = useWorkspace()
  const repository = workspace.repositories.find((item) => item.id === repositoryId)
  const [rows, setRows] = useState<SavedPrompt[]>(() =>
    repository?.prompts?.length
      ? repository.prompts
      : [{ id: randomUUID(), name: 'bugfix', text: '' }],
  )
  const [initialRows] = useState(rows)
  const [error, setError] = useState('')
  const [validated, setValidated] = useState(false)
  const [focusId, setFocusId] = useState('')
  const fields = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>())
  const close = () => {
    if (confirmDiscardChanges(JSON.stringify(rows) !== JSON.stringify(initialRows))) onClose()
  }
  const normalizedName = (name: string) => name.trim().replace(/\s+/g, '-')
  const issues = new Map<string, string>()
  for (const row of rows) {
    const name = normalizedName(row.name)
    if (
      name &&
      rows.filter((item) => normalizedName(item.name).toLowerCase() === name.toLowerCase()).length >
        1
    )
      issues.set(`${row.id}:name`, 'This name is already used.')
    if (validated && (row.name || row.text) && !name) issues.set(`${row.id}:name`, 'Enter a name.')
    if (validated && name && !/^[\w.-]+$/.test(name))
      issues.set(`${row.id}:name`, 'Use letters, numbers, dots, dashes or underscores.')
    if (validated && (row.name || row.text) && !row.text.trim())
      issues.set(`${row.id}:text`, 'Enter prompt text.')
  }
  useEffect(() => {
    if (!focusId) return
    const field = fields.current.get(focusId)
    field?.focus()
    field?.scrollIntoView({ block: 'nearest' })
    setFocusId('')
  }, [focusId, rows])
  const change = (id: string, changes: Partial<SavedPrompt>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)))
  const save = () => {
    setValidated(true)
    const cleaned = rows
      .map((row) => ({ ...row, name: row.name.trim().replace(/\s+/g, '-'), text: row.text.trim() }))
      .filter((row) => row.name || row.text)
    if (cleaned.some((row) => !row.name || !row.text)) {
      const invalid = cleaned.find((row) => !row.name || !row.text)
      if (invalid) setFocusId(`${invalid.id}:${!invalid.name ? 'name' : 'text'}`)
      setError('Give every prompt a name and text, or remove it.')
      return
    }
    if (cleaned.some((row) => !/^[\w.-]+$/.test(row.name))) {
      const invalid = cleaned.find((row) => !/^[\w.-]+$/.test(row.name))
      if (invalid) setFocusId(`${invalid.id}:name`)
      setError('Names may use letters, numbers, dots, dashes and underscores, so #name finds them.')
      return
    }
    if (new Set(cleaned.map((row) => row.name.toLowerCase())).size !== cleaned.length) {
      const invalid = cleaned.find(
        (row) =>
          cleaned.filter((item) => item.name.toLowerCase() === row.name.toLowerCase()).length > 1,
      )
      if (invalid) setFocusId(`${invalid.id}:name`)
      setError('Each prompt needs a different name.')
      return
    }
    try {
      setWorkspace((current) => ({
        ...current,
        repositories: current.repositories.map((item) =>
          item.id === repositoryId
            ? { ...item, prompts: cleaned.length ? cleaned : undefined }
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
        <DialogTitle>Saved prompts</DialogTitle>
        <DialogDescription>
          Reusable prompts for {repository?.name ?? 'this project'}. Type # and the name in the
          composer to insert one.
        </DialogDescription>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {rows.map((row, index) => (
            <div key={row.id} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">#</span>
                <Input
                  aria-label={`Prompt ${index + 1} name`}
                  ref={(node) => {
                    if (node) fields.current.set(`${row.id}:name`, node)
                    else fields.current.delete(`${row.id}:name`)
                  }}
                  aria-invalid={issues.has(`${row.id}:name`)}
                  aria-describedby={`${row.id}-name-help`}
                  placeholder="name"
                  value={row.name}
                  maxLength={60}
                  onChange={(event) => change(row.id, { name: event.target.value })}
                  className="h-8 flex-1 font-mono text-xs"
                />
                <IconButton
                  label={`Remove prompt ${index + 1}: ${row.name || 'Untitled'}`}
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
                {issues.get(`${row.id}:name`) ?? `${row.name.length}/60 characters`}
              </p>
              <Textarea
                aria-label={`Prompt ${index + 1} text`}
                ref={(node) => {
                  if (node) fields.current.set(`${row.id}:text`, node)
                  else fields.current.delete(`${row.id}:text`)
                }}
                aria-invalid={issues.has(`${row.id}:text`)}
                aria-describedby={`${row.id}-text-help`}
                placeholder="Reproduce the bug first, then fix it with a test that fails before the fix."
                value={row.text}
                maxLength={20000}
                onChange={(event) => change(row.id, { text: event.target.value })}
                className="min-h-20 text-xs"
              />
              <p
                id={`${row.id}-text-help`}
                className={
                  issues.has(`${row.id}:text`)
                    ? 'text-xs text-destructive'
                    : 'text-xs text-muted-foreground'
                }
              >
                {issues.get(`${row.id}:text`) ??
                  `${row.text.length.toLocaleString()}/20,000 characters`}
              </p>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-fit gap-1"
          disabled={rows.length >= 40}
          onClick={() => {
            const id = randomUUID()
            setRows((current) => [...current, { id, name: '', text: '' }])
            setFocusId(`${id}:name`)
          }}
        >
          <Plus className="size-3.5" /> Add prompt
        </Button>
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
