import { useEffect, useState } from 'react'
import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Textarea,
} from '@dovo/studio-ui'
import { confirmDiscardChanges } from './unsaved-changes'

const readSchema = mutableStruct({ text: Schema.String, version: Schema.String })
const previewSchema = mutableStruct({ diff: Schema.String, changed: Schema.Boolean })
const saveSchema = mutableStruct({ version: Schema.String })
type Name = 'AGENTS.md' | 'CLAUDE.md'
type Draft = { text: string; original: string; version: string; diff: string }
export function ProjectInstructionsDialog({
  repositoryId,
  onClose,
}: {
  repositoryId: string
  onClose: () => void
}) {
  const { request, connected } = useWorkspace()
  const [name, setName] = useState<Name>('AGENTS.md')
  const [drafts, setDrafts] = useState<Partial<Record<Name, Draft>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [saved, setSaved] = useState('')
  const draft = drafts[name]
  const dirty = Object.values(drafts).some((item) => item.text !== item.original)
  const close = () => {
    if (!busy && confirmDiscardChanges(dirty)) onClose()
  }
  useEffect(() => {
    setError('')
    if (!connected || draft) {
      setBusy(false)
      return
    }
    let active = true
    setBusy(true)
    void request('/api/scm/instructions/read', { repositoryId, name }, readSchema)
      .then((result) => {
        if (active) {
          setBusy(false)
          setDrafts((current) => ({
            ...current,
            [name]: { text: result.text, original: result.text, version: result.version, diff: '' },
          }))
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [repositoryId, name, connected, request, !!draft, reload])
  const update = (change: Partial<Draft>) => {
    setDrafts((current) => {
      const previous = current[name]
      return previous ? { ...current, [name]: { ...previous, ...change } } : current
    })
    setSaved('')
  }
  const preview = async () => {
    if (busy || !connected || !draft) return
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/scm/instructions/preview',
        { repositoryId, name, text: draft.text, version: draft.version },
        previewSchema,
      )
      update({ diff: result.changed ? result.diff : 'No changes' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (busy || !connected || !draft || !draft.diff || draft.diff === 'No changes') return
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/scm/instructions/save',
        { repositoryId, name, text: draft.text, version: draft.version },
        saveSchema,
      )
      update({ original: draft.text, version: result.version, diff: '' })
      setSaved(`${name} saved.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogTitle>Project instructions</DialogTitle>
        <DialogDescription>
          Edit the project root file. Review the diff before saving. Drafts are kept when switching
          files.
        </DialogDescription>
        <div className="flex gap-2">
          {(['AGENTS.md', 'CLAUDE.md'] as const).map((item) => (
            <Button
              key={item}
              variant={name === item ? 'default' : 'outline'}
              size="sm"
              disabled={busy}
              onClick={() => {
                setName(item)
                setSaved('')
              }}
            >
              {item}
              {drafts[item] && drafts[item].text !== drafts[item].original ? ' · Unsaved' : ''}
            </Button>
          ))}
        </div>
        <Textarea
          aria-label={name}
          value={draft?.text ?? ''}
          disabled={busy || !connected || !draft}
          onChange={(event) => update({ text: event.target.value, diff: '' })}
          className="min-h-48 flex-1 font-mono text-xs"
        />
        {draft?.diff && (
          <pre
            aria-label="Instruction diff"
            className="max-h-48 overflow-auto rounded border bg-muted p-2 text-xs"
          >
            {draft.diff}
          </pre>
        )}
        {error && (
          <div role="alert" className="text-xs text-destructive">
            <p>{error}</p>
            {!draft && (
              <Button
                disabled={busy || !connected}
                variant="outline"
                onClick={() => setReload((value) => value + 1)}
              >
                Retry loading instructions
              </Button>
            )}
          </div>
        )}
        {saved && (
          <p role="status" className="text-xs text-muted-foreground">
            {saved}
          </p>
        )}
        {!connected && (
          <p role="status" className="text-xs text-muted-foreground">
            Reconnect to review or save instructions. Your drafts are kept.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={close}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={busy || !connected || !draft?.version}
            onClick={() => void preview()}
          >
            Review diff
          </Button>
          <Button
            disabled={
              busy || !connected || !draft?.version || !draft.diff || draft.diff === 'No changes'
            }
            onClick={() => void save()}
          >
            Save instructions
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
