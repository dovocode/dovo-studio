import { createDraftStash, randomUUID, restoreStashedText, type StashedDraft } from '@dovo/protocol'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
} from '@dovo/studio-ui'
import { Archive, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const stash = createDraftStash({
  getAllKeys: async () => Object.keys(localStorage),
  getItem: async (key) => localStorage.getItem(key),
  setItem: async (key, value) => localStorage.setItem(key, value),
  removeItem: async (key) => localStorage.removeItem(key),
})

export function DraftStash(props: {
  scope?: string
  getText: () => string
  onChange: (text: string) => void
  focus: () => void
  hasAttachments: boolean
  disabled?: boolean
  showLabel?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<StashedDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(props)
  latest.current = props
  const restoreFocus = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const load = async () => {
    if (!props.scope) return
    setError('')
    setBusy(true)
    try {
      const rows = await stash.list(props.scope)
      if (active.current) setEntries(rows)
    } catch {
      if (active.current) setError('Could not read stashed drafts. Your saved data was kept.')
    } finally {
      if (active.current) setBusy(false)
    }
  }
  const save = async () => {
    if (!props.scope || busy || props.disabled || props.hasAttachments) return
    const text = props.getText()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      await stash.save(props.scope, { id: randomUUID(), text, createdAt: Date.now() })
      if (!active.current) return
      const current = latest.current
      if (!current.disabled && !current.hasAttachments && current.getText() === text)
        current.onChange('')
      const rows = await stash.list(props.scope)
      if (active.current) setEntries(rows)
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : 'Could not stash this draft.')
    } finally {
      if (active.current) setBusy(false)
    }
  }
  const remove = async (id: string) => {
    if (!props.scope || busy) return
    setBusy(true)
    setError('')
    try {
      await stash.remove(props.scope, id)
      const rows = await stash.list(props.scope)
      if (active.current) setEntries(rows)
    } catch {
      if (active.current) setError('Could not delete the saved draft.')
    } finally {
      if (active.current) setBusy(false)
    }
  }
  return (
    <>
      <IconButton
        label="Stashed drafts"
        type="button"
        className={
          props.showLabel ? 'h-10 w-full justify-start gap-2 px-3 text-sm font-normal' : 'size-7'
        }
        disabled={props.disabled || !props.scope}
        onClick={() => {
          setOpen(true)
          void load()
        }}
      >
        <Archive className="size-3.5" />
        {props.showLabel && 'Stashed drafts'}
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-lg"
          onCloseAutoFocus={(event) => {
            if (restoreFocus.current) {
              event.preventDefault()
              restoreFocus.current = false
              latest.current.focus()
            }
          }}
        >
          <DialogTitle>Stashed drafts</DialogTitle>
          <DialogDescription>
            Text saved on this device for this thread. Restoring appends to your draft and keeps a
            saved copy.
          </DialogDescription>
          {props.hasAttachments && (
            <p className="text-xs text-muted-foreground">
              Remove attachments before stashing or restoring a text draft.
            </p>
          )}
          <Button
            disabled={busy || props.disabled || props.hasAttachments || !props.getText().trim()}
            onClick={() => void save()}
          >
            Stash current text
          </Button>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {!busy && !entries.length && (
              <p className="text-sm text-muted-foreground">No stashed drafts yet.</p>
            )}
            {entries.map((entry) => (
              <div key={entry.id} className="flex min-w-0 items-start gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">
                    {entry.text}
                  </p>
                  <time className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </time>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || props.disabled || props.hasAttachments}
                  onClick={() => {
                    const current = latest.current
                    if (current.disabled || current.hasAttachments) return
                    try {
                      current.onChange(restoreStashedText(current.getText(), entry.text))
                      restoreFocus.current = true
                      setOpen(false)
                    } catch {
                      setError('Could not restore the draft. The saved copy was kept.')
                    }
                  }}
                >
                  Restore
                </Button>
                <IconButton
                  label="Delete stashed draft"
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(entry.id)}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
