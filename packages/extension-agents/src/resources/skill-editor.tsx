import { resourceError } from './error'
import { useState } from 'react'
import { managedSkillSchema, useWorkspace, type ManagedSkill } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  FormField,
  Input,
  Textarea,
} from '@dovo/studio-ui'
export function SkillEditor({
  initial,
  scope,
  onSave,
  onClose,
}: {
  initial?: ManagedSkill
  scope: string
  onSave: (skill: ManagedSkill) => Promise<void>
  onClose: () => void
}) {
  const { request } = useWorkspace()
  const [draft, setDraft] = useState<ManagedSkill>(
    initial ?? { name: '', description: '', content: '', enabled: true },
  )
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const perform = async (importing: boolean) => {
    setBusy(true)
    setError('')
    try {
      if (importing)
        setDraft(await request('/api/agents/skills/import', { path }, managedSkillSchema))
      else await onSave(managedSkillSchema.parse(draft))
    } catch (error) {
      setError(resourceError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit skill' : 'Add skill'}</DialogTitle>
          <DialogDescription>{scope}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void perform(false)
          }}
        >
          <fieldset disabled={busy} className="grid gap-4">
            <FormField label="Import from runtime">
              <div className="flex gap-2">
                <Input
                  aria-label="SKILL.md path"
                  placeholder="~/skills/example/SKILL.md"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!path.trim()}
                  onClick={() => void perform(true)}
                >
                  Import
                </Button>
              </div>
            </FormField>
            <p className="text-xs text-muted-foreground">
              Import copies the instructions. Supporting files remain at the source location on the
              runtime.
            </p>
            <FormField label="Name">
              <Input
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </FormField>
            <FormField label="When to use">
              <Textarea
                required
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </FormField>
            <FormField label="Instructions">
              <Textarea
                required
                className="min-h-48"
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              />
            </FormField>
            {draft.sourceUrl && (
              <a
                className="text-xs underline"
                href={draft.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                skills.sh source · {draft.sourceRevision?.slice(0, 12)}
              </a>
            )}
            {draft.sourcePath && (
              <p className="break-all text-xs text-muted-foreground">Source: {draft.sourcePath}</p>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive whitespace-pre-wrap">
                {error}
              </p>
            )}
            <Button type="submit">{busy ? 'Working…' : 'Save skill'}</Button>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
