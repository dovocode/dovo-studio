/** A synced backup is optional recovery, never a replacement for a different workspace draft. */
export function ComposerDraftRecovery({
  text,
  onDiscard,
}: {
  text: string
  onDiscard: () => void
}) {
  if (!text.trim()) return null
  return (
    <details className="mx-3 my-2 rounded-lg border p-3 text-xs">
      <summary>Saved local draft</summary>
      <p className="py-2 text-muted-foreground">
        This draft differs from the workspace. Select and copy the text you want to keep.
      </p>
      <textarea
        aria-label="Saved local draft"
        readOnly
        value={text}
        className="w-full rounded border p-2 text-sm"
      />
      <button type="button" className="mt-2 underline" onClick={onDiscard}>
        Discard saved local draft
      </button>
    </details>
  )
}
