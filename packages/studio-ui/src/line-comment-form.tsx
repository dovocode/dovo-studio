import { suggestionComment } from './suggestion'
import { useState, type ReactNode } from 'react'
import { Button } from './components/ui/button'
import { Textarea } from './components/ui/textarea'
export function LineCommentForm({
  label,
  submitLabel,
  onSubmit,
  onCancel,
  children,
  selectedCode,
}: {
  label: string
  submitLabel: string
  onSubmit: (body: string) => Promise<void>
  onCancel: () => void
  children?: ReactNode
  selectedCode?: string
}) {
  const [body, setBody] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [suggesting, setSuggesting] = useState(false),
    [replacement, setReplacement] = useState(selectedCode ?? '')
  const submitted = suggesting ? suggestionComment(body, replacement) : body.trim()
  return (
    <form
      className="space-y-2 rounded border bg-background p-3 text-xs"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        try {
          await onSubmit(submitted)
        } catch (e) {
          setError(String(e))
        } finally {
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
        onChange={(e) => setBody(e.target.value)}
        placeholder="Explain what should change and why…"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || selectedCode === undefined}
        onClick={() => setSuggesting((v) => !v)}
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
            onChange={(e) => setReplacement(e.target.value)}
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
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !submitted || submitted.length > 10000}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
