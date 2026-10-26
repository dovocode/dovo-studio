import { useState } from 'react'
import {
  browserWebsiteCustomizationSchema,
  browserWebsiteScriptError,
  decodeResult,
  type BrowserWebsiteCustomization,
} from '@dovo/protocol'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'

export function WebsiteCustomizationEditor({
  website,
  profileName,
  onSave,
  onAgent,
  onClose,
}: {
  website: BrowserWebsiteCustomization
  profileName: string
  onSave: (website: BrowserWebsiteCustomization | null) => Promise<void>
  onAgent: (website: BrowserWebsiteCustomization) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(website)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (remove = false) => {
    setError('')
    const scriptError = !remove && draft.enabled && browserWebsiteScriptError(draft.script)
    if (scriptError) {
      setError(`JavaScript: ${scriptError}`)
      return
    }
    const result = decodeResult(browserWebsiteCustomizationSchema, draft)
    if (!result.success) {
      setError('CSS and JavaScript must each be at most 64,000 characters.')
      return
    }
    setBusy(true)
    try {
      await onSave(remove ? null : result.data)
      onClose()
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
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden">
        <DialogTitle>Customize website</DialogTitle>
        <DialogDescription className="break-all">
          {website.origin} · {profileName}. Saved for this profile only.
        </DialogDescription>
        <div className="min-h-0 space-y-3 overflow-y-auto">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />{' '}
            Enable customization
          </label>
          <label className="block space-y-1 text-sm">
            CSS
            <textarea
              aria-label="Website CSS"
              className="min-h-40 w-full rounded-md border bg-background p-2 font-mono text-xs"
              spellCheck={false}
              maxLength={64000}
              value={draft.css}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, css: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-sm">
            JavaScript (optional)
            <textarea
              aria-label="Website JavaScript"
              className="min-h-32 w-full rounded-md border bg-background p-2 font-mono text-xs"
              spellCheck={false}
              maxLength={64000}
              value={draft.script}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, script: event.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Scripts run on each page load with this website’s permissions. Saving, disabling or
            removing reloads this tab. Reload clears changes to the page, but cannot undo script
            changes to website data.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onAgent(draft)}>
            Customize with agent…
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>
            Remove
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save and reload'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
