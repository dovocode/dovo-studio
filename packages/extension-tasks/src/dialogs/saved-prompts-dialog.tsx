import { randomUUID } from '@dovo/protocol'
import { useState } from 'react'
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
  const [error, setError] = useState('')
  const change = (id: string, changes: Partial<SavedPrompt>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)))
  const save = () => {
    const cleaned = rows
      .map((row) => ({ ...row, name: row.name.trim().replace(/\s+/g, '-'), text: row.text.trim() }))
      .filter((row) => row.name || row.text)
    if (cleaned.some((row) => !row.name || !row.text)) {
      setError('Give every prompt a name and text, or remove it.')
      return
    }
    if (cleaned.some((row) => !/^[\w.-]+$/.test(row.name))) {
      setError('Names may use letters, numbers, dots, dashes and underscores, so #name finds them.')
      return
    }
    if (new Set(cleaned.map((row) => row.name.toLowerCase())).size !== cleaned.length) {
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Saved prompts</DialogTitle>
        <DialogDescription>
          Reusable prompts for {repository?.name ?? 'this project'}. Type # and the name in the
          composer to insert one.
        </DialogDescription>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {rows.map((row) => (
            <div key={row.id} className="space-y-1 rounded-md border p-2">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">#</span>
                <Input
                  aria-label="Prompt name"
                  placeholder="name"
                  value={row.name}
                  maxLength={60}
                  onChange={(event) => change(row.id, { name: event.target.value })}
                  className="h-8 flex-1 font-mono text-xs"
                />
                <IconButton
                  label="Remove prompt"
                  className="size-8"
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              <Textarea
                aria-label="Prompt text"
                placeholder="Reproduce the bug first, then fix it with a test that fails before the fix."
                value={row.text}
                maxLength={20000}
                onChange={(event) => change(row.id, { text: event.target.value })}
                className="min-h-20 text-xs"
              />
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-fit gap-1"
          disabled={rows.length >= 40}
          onClick={() =>
            setRows((current) => [...current, { id: randomUUID(), name: '', text: '' }])
          }
        >
          <Plus className="size-3.5" /> Add prompt
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
