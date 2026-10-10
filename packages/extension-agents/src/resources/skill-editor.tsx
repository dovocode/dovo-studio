import { useApplicationState } from '@dovo/studio-core/state'
import { decode } from '@dovo/protocol'
import { resourceError } from './error'
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
  const [draft, setDraft] = useApplicationState<ManagedSkill>(
    initial ?? {
      name: '',
      description: '',
      content: '',
      enabled: true,
    },
  )
  const [path, setPath] = useApplicationState('')
  const [busy, setBusy] = useApplicationState<'import' | 'save' | null>(null)
  const [error, setError] = useApplicationState('')
  const perform = async (importing: boolean) => {
    setBusy(importing ? 'import' : 'save')
    setError('')
    try {
      if (importing)
        setDraft(
          await request(
            '/api/agents/skills/import',
            {
              path,
            },
            managedSkillSchema,
          ),
        )
      else await onSave(decode(managedSkillSchema, draft))
    } catch (error) {
      setError(resourceError(error))
    } finally {
      setBusy(null)
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
          <DialogDescription>
            Saved at {scope}. Write the instructions here or import an existing SKILL.md.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void perform(false)
          }}
        >
          <fieldset disabled={!!busy} className="grid gap-4">
            <FormField label="Import a SKILL.md from this computer (optional)">
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
                  {busy === 'import' ? 'Importing…' : 'Import'}
                </Button>
              </div>
            </FormField>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Import copies the instructions into the fields below. Supporting files stay where they
              are on this computer.
            </p>
            <FormField label="Name">
              <Input
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    name: event.target.value,
                  })
                }
              />
            </FormField>
            <FormField label="When to use">
              <Textarea
                required
                placeholder="Describe when the agent should apply this skill…"
                value={draft.description}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    description: event.target.value,
                  })
                }
              />
            </FormField>
            <FormField label="Instructions">
              <Textarea
                required
                className="min-h-48"
                value={draft.content}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    content: event.target.value,
                  })
                }
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
              <div className="space-y-2">
                <p className="break-all text-xs text-muted-foreground">
                  Source: {draft.sourcePath}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sourcePath: undefined,
                      sourceUrl: undefined,
                      sourceRevision: undefined,
                    })
                  }
                >
                  Use instructions only
                </Button>
                <p className="text-xs text-muted-foreground">
                  Supporting files stay on this environment. This copy will contain only the
                  instructions.
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive whitespace-pre-wrap">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">{busy === 'save' ? 'Saving…' : 'Save skill'}</Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
