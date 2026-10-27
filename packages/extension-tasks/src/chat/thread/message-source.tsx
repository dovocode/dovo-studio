import { messageSourceLabel, type MessageSource as Source } from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'

export function MessageSource({ source }: { source: Source }) {
  const host = useStudioHost()
  const { activeRuntimeId } = useWorkspace()
  const label = messageSourceLabel(source)
  const className = 'min-w-0 truncate text-xs text-muted-foreground'
  if (source.kind === 'pipeline' || source.kind === 'pull-request')
    return (
      <a
        className={`${className} hover:underline`}
        href={source.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open source: ${label}`}
      >
        {label}
      </a>
    )
  if (source.kind === 'thread')
    return (
      <button
        type="button"
        className={`${className} text-left hover:underline disabled:no-underline`}
        title={label}
        aria-label={`Open source thread: ${label}`}
        disabled={!host.openThread}
        onClick={() =>
          host.openThread?.({
            runtimeId: source.runtimeId === 'local' ? activeRuntimeId : source.runtimeId,
            ...(source.runtimeIdentity ? { runtimeIdentity: source.runtimeIdentity } : {}),
            threadId: source.threadId,
            title: source.title,
          })
        }
      >
        {label}
      </button>
    )
  if (source.kind === 'automation')
    return (
      <button
        type="button"
        className={`${className} text-left hover:underline`}
        title={label}
        aria-label={`Open source: ${label}`}
        onClick={() => host.navigate({ viewId: 'jobs', entityId: source.runId })}
      >
        {label}
      </button>
    )
  return <span className={className}>{label}</span>
}
