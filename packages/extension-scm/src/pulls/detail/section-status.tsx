import { Button } from '@dovo/studio-ui'
import type { usePullDetail } from './use-pull-detail'

export function PullSectionStatus({
  label,
  section,
}: {
  label: string
  section: ReturnType<typeof usePullDetail>['sections']['overview']
}) {
  const error = section.error || section.detail?.refreshError || section.detail?.pull.statusError
  const warnings = section.detail?.warnings ?? []
  if (section.enabled === false) return null
  if (section.ready && !error && !warnings.length && !section.detail?.stale) return null
  return (
    <div
      className="my-2 min-w-0 space-y-1 text-xs [overflow-wrap:anywhere]"
      aria-label={`${label} loading status`}
    >
      <p
        role={error ? 'alert' : 'status'}
        className={error ? 'text-destructive' : 'text-muted-foreground'}
      >
        {error
          ? `${label}: ${error}`
          : section.ready
            ? section.detail?.stale
              ? `${label}: showing cached data.`
              : `${label}: some data could not be loaded.`
            : section.readConnected
              ? `Loading ${label.toLowerCase()}…`
              : `${label}: connect to load this section.`}
      </p>
      {warnings.map((warning) => (
        <p key={warning} role="alert" className="text-destructive">
          {warning}
        </p>
      ))}
      <Button
        size="sm"
        variant="outline"
        disabled={!section.readConnected || section.busy}
        onClick={section.refresh}
      >
        {section.refreshing
          ? `Refreshing ${label.toLowerCase()}…`
          : `Refresh ${label.toLowerCase()}`}
      </Button>
    </div>
  )
}
