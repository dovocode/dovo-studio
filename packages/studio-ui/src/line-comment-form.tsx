import { useApplicationState } from '@dovo/studio-core/state'
import { suggestionComment } from './suggestion'
import { useRef, type ReactNode } from 'react'
import { Button } from './components/ui/button'
import { Textarea } from './components/ui/textarea'
export function LineCommentForm({
  label,
  submitLabel,
  onSubmit,
  onCancel,
  children,
  selectedCode,
  draft,
  onDraft,
  disabled = false,
}: {
  label: string
  submitLabel: string
  onSubmit: (body: string) => Promise<void>
  onCancel: () => void
  children?: ReactNode
  selectedCode?: string
  draft?: { body: string; suggesting: boolean; replacement: string }
  onDraft?: (draft: { body: string; suggesting: boolean; replacement: string }) => void
  disabled?: boolean
}) {
  const [localDraft, setLocalDraft] = useApplicationState({
      body: '',
      suggesting: false,
      replacement: selectedCode ?? '',
    }),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const { body, suggesting, replacement } = draft ?? localDraft
  const updateDraft = onDraft ?? setLocalDraft
  const pending = useRef(false)
  const submitted = suggesting ? suggestionComment(body, replacement) : body.trim()
  return (
    <form
      className="space-y-2 rounded border bg-background p-3 text-xs"
      onSubmit={async (e) => {
        e.preventDefault()
        if (disabled || pending.current || !submitted || submitted.length > 10000) return
        pending.current = true
        setBusy(true)
        setError('')
        try {
          await onSubmit(submitted)
        } catch (e) {
          setError(String(e))
        } finally {
          pending.current = false
          setBusy(false)
        }
      }}
    >
      <p className="font-medium">{label}</p>
      {children}
      <Textarea
        autoFocus
        aria-label="Line comment"
        value={body}
        disabled={busy}
        maxLength={10000}
        onChange={(e) => updateDraft({ body: e.target.value, suggesting, replacement })}
        placeholder="Explain what should change and why…"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || selectedCode === undefined}
        onClick={() => updateDraft({ body, suggesting: !suggesting, replacement })}
      >
        {suggesting ? 'Remove suggestion' : 'Suggest code change'}
      </Button>
      {selectedCode === undefined && (
        <p className="text-muted-foreground">
          Select lines on the new side to suggest replacement code.
        </p>
      )}
      {suggesting && (
        <div className="space-y-2">
          <p>Replace the selected lines with:</p>
          <Textarea
            aria-label="Suggested replacement"
            className="min-h-28 font-mono text-xs"
            value={replacement}
            disabled={busy}
            maxLength={9900}
            onChange={(e) => updateDraft({ body, suggesting, replacement: e.target.value })}
          />
          <p className="text-muted-foreground">
            An empty replacement suggests deleting the selected lines. This does not edit files
            automatically.
          </p>
        </div>
      )}
      {submitted.length > 10000 && (
        <p role="alert" className="text-destructive">
          Comment and suggestion must fit within 10,000 characters.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {disabled && (
        <p role="status" className="text-muted-foreground">
          Offline · your draft is preserved. Connect to submit.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || busy || !submitted || submitted.length > 10000}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
