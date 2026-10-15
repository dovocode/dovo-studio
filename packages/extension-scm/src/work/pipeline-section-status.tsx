import { Button } from '@dovo/studio-ui'
import { LoaderCircle } from 'lucide-react'
export function PipelineSectionStatus({
  label,
  state,
  connected,
}: {
  label: string
  state: {
    ready: boolean
    error: string
    busy: boolean
    detail?: { stale?: boolean }
    refresh: () => void
  }
  connected: boolean
}) {
  if (state.ready && !state.error && !state.detail?.stale) return null
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-xs [overflow-wrap:anywhere]"
      aria-label={`${label} loading status`}
    >
      <p
        role={state.error ? 'alert' : 'status'}
        className={`min-w-0 flex-1 ${state.error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {state.error
          ? `${label}: ${state.error}`
          : state.ready
            ? `${label}: showing cached data.`
            : connected
              ? `Loading ${label.toLowerCase()}…`
              : `${label}: connect to load this section.`}
      </p>
      {state.busy && (
        <LoaderCircle
          aria-hidden="true"
          className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      )}
      {(!state.busy || state.ready) && (
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || state.busy}
          onClick={state.refresh}
        >
          Refresh {label.toLowerCase()}
        </Button>
      )}
    </div>
  )
}
