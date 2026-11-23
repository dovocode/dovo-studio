import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { SCRATCH_PROJECT_ID, type dashboardReadResultSchema } from '@dovo/protocol'
import {
  studioReadingKey,
  useStudioDataSource,
  useWorkspace,
  type StudioReadingOwner,
  type StudioReadingSource,
} from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button } from '@dovo/studio-ui'
import { DataView } from './data-view'

type Props = {
  source: StudioReadingSource
  owner: StudioReadingOwner
  read: () => Promise<typeof dashboardReadResultSchema.Type>
  onData?: (value: unknown) => void
}

export function DataSource(props: Props) {
  const { connection, activeRuntimeId, snapshot, workspace } = useWorkspace()
  const { owner, source } = props
  const project =
    source.kind === 'cli'
      ? workspace.repositories.find((entry) => entry.id === source.repositoryId)
      : undefined
  const identity = studioReadingKey(
    connection,
    snapshot?.runtimeId ?? activeRuntimeId,
    owner,
    source,
    project?.path,
  )
  const seconds = 'refreshSeconds' in source ? source.refreshSeconds : undefined
  return (
    <DataSourceView
      key={JSON.stringify([identity, seconds])}
      {...props}
      identity={identity}
      projectName={project?.name}
    />
  )
}

function DataSourceView({
  source,
  read,
  onData,
  identity,
  projectName,
}: Props & { identity: string; projectName?: string }) {
  const uiText = useInterfaceText()
  const { connected, snapshot } = useWorkspace()
  const seconds = 'refreshSeconds' in source ? source.refreshSeconds : undefined
  // Existing HTTP tiles continue to work with runtimes that predate structured sources.
  const supported =
    source.kind === 'mcp' ||
    (source.kind === 'api' && seconds === undefined && !source.panels) ||
    snapshot?.studioDataSourcesSupported === true
  const host = useRef<HTMLDivElement>(null)
  const disclosures = useRef<HTMLDetailsElement[]>([])
  const canRead = useCallback(
    () =>
      !document.hidden &&
      (source.kind !== 'api' || document.hasFocus()) &&
      disclosures.current.every((node) => node.open),
    [source.kind],
  )
  const [visible, setVisible] = useState(false)
  useLayoutEffect(() => {
    const ancestors: HTMLDetailsElement[] = []
    for (let node = host.current?.parentElement; node; node = node.parentElement)
      if (node instanceof HTMLDetailsElement) ancestors.push(node)
    disclosures.current = ancestors
    const update = () => setVisible(canRead())
    const observer = new MutationObserver(update)
    for (const node of ancestors)
      observer.observe(node, { attributes: true, attributeFilter: ['open'] })
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    update()
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [canRead])
  const state = useStudioDataSource(
    identity,
    source,
    connected && supported && visible,
    read,
    onData,
    canRead,
  )
  const project =
    source.kind === 'cli'
      ? (projectName ??
        (source.repositoryId === SCRATCH_PROJECT_ID ? 'No Project' : source.repositoryId))
      : undefined
  const detail =
    source.kind === 'cli'
      ? source.command
      : source.kind === 'api'
        ? source.url
        : `${source.server} · ${source.tool}`
  return (
    <div ref={host} className="min-w-0 space-y-2 text-sm">
      {onData && <p className="font-medium">{source.title}</p>}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        {project && <span className="font-medium">{project}</span>}
        <span className="min-w-0 truncate" title={detail}>
          {detail}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!supported || !connected || state.busy}
          onClick={() => {
            if (
              source.kind !== 'cli' ||
              window.confirm(`Run this command in ${project}?\n\n${detail}`)
            )
              void state.refresh()
          }}
        >
          {state.busy ? 'Reading…' : source.kind === 'cli' ? 'Run command' : 'Refresh data'}
        </Button>
        {seconds !== undefined && (
          <Button
            size="sm"
            variant="outline"
            disabled={!state.running && (!supported || !connected || state.busy)}
            onClick={() => {
              if (state.running) state.stop()
              else if (
                source.kind === 'api' ||
                window.confirm(
                  `Run this command in ${project} every ${seconds} seconds while this tile is open?\n\n${detail}`,
                )
              )
                state.start()
            }}
          >
            {state.running ? 'Stop auto refresh' : `Start auto refresh (${seconds}s)`}
          </Button>
        )}
        {state.data && (
          <time
            className="text-xs text-muted-foreground"
            dateTime={new Date(state.data.updatedAt).toISOString()}
          >
            {uiText(state.stale ? 'Last result {time} · stale' : 'Updated {time}', {
              time: new Date(state.data.updatedAt).toLocaleTimeString(),
            })}
          </time>
        )}
        {!supported && <span>Update the paired computer to use these data displays.</span>}
        {!connected && <span>Computer offline</span>}
      </div>
      {state.error && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      {!onData && state.data && (
        <DataView value={state.data.data} chart={source.chart} panels={source.panels} />
      )}
    </div>
  )
}
