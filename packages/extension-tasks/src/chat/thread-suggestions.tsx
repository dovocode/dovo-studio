import type { AccountClient } from '@dovo/protocol'
import { useThreadSuggestions } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

export function ThreadSuggestions({
  client,
  sourceId,
  active,
  onUseSuggestion,
}: {
  client: AccountClient
  sourceId: string
  active?: boolean
  onUseSuggestion: (text: string) => void
}) {
  const inbox = useThreadSuggestions(client, sourceId, active)
  if (!inbox.suggestions.length)
    return inbox.error ? (
      <p
        role="alert"
        className="mx-auto w-full max-w-[var(--chat-max)] px-5 py-2 text-xs text-destructive"
      >
        {inbox.error}
      </p>
    ) : null
  return (
    <section
      aria-label="Suggested next prompts"
      className="mx-auto w-full max-w-[var(--chat-max)] space-y-3 px-5 py-4"
    >
      <h3 className="text-xs font-medium text-muted-foreground">Suggested next prompts</h3>
      {inbox.suggestions.map((item) => (
        <div key={item.id} className="space-y-2 rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            {item.value?.name || 'Reader'} · Suggested prompt
          </p>
          <p className="whitespace-pre-wrap break-words text-sm">
            {item.value?.text ?? item.error}
          </p>
          <div className="flex flex-wrap gap-2">
            {item.value && (
              <Button
                size="sm"
                onClick={() => {
                  if (item.value) onUseSuggestion(item.value.text)
                }}
              >
                Use in composer
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={inbox.busy !== null}
              onClick={() => void inbox.dismiss(item.id)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
      {inbox.error && (
        <p role="alert" className="text-xs text-destructive">
          {inbox.error}
        </p>
      )}
    </section>
  )
}
