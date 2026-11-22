import { useState } from 'react'
import { Button, Card, Input } from '@dovo/studio-ui'
import {
  marketplaceNeedsSource,
  SCRATCH_PROJECT_ID,
  type MarketplaceBinding,
  type MarketplaceSourceContribution,
  type StudioExtensionCommand,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import {
  addMarketplaceDashboard,
  marketplaceContributionSource,
  useExtensionMarketplace,
  useMarketplaceSources,
  useStudioHost,
  useWorkspace,
} from '@dovo/studio-core'

export function ExtensionMarketplace({
  entries,
  busy,
  stage,
  review,
}: {
  entries: StudioExtensionEntry[]
  busy: boolean
  stage: (input: StudioExtensionCommand) => Promise<boolean>
  review: (entry: StudioExtensionEntry) => void
}) {
  const { request, connected, snapshot } = useWorkspace()
  const host = useStudioHost()
  const state = useExtensionMarketplace(
    request,
    connected,
    snapshot?.studioExtensionsRevision,
    entries,
  )
  const [dashboard, setDashboard] = useState<{ digest: string; issue?: string; added?: boolean }>()
  const [adding, setAdding] = useState(false)
  const selected = state.selected
  const release = state.release
  const current = entries.find((entry) => entry.id === selected?.id)
  const command = state.stage(current)

  return (
    <section aria-label="Extension marketplace" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search extensions"
          className="max-w-sm"
          value={state.search.query}
          onChange={(event) => state.search.setQuery(event.target.value)}
        />
        <Button variant="outline" size="sm" disabled={!connected} onClick={state.reload}>
          Reload marketplace
        </Button>
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      {!state.packages && !state.error && (
        <p role="status">
          {connected ? 'Loading marketplace…' : 'Connect this computer to browse the marketplace.'}
        </p>
      )}
      {state.packages?.length === 0 && <p>No extensions match.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {state.packages?.map((entry) => (
          <Card key={entry.digest} className="space-y-2 p-3">
            <h3 className="font-medium">{entry.name}</h3>
            <p className="text-sm text-muted-foreground">
              {entry.publisher} · {entry.version}
              {entry.installed?.digest === entry.digest &&
                (entries.find((item) => item.id === entry.id)?.enabled
                  ? ' · Installed'
                  : ' · Disabled')}
            </p>
            <p className="text-sm">{entry.description}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={!connected}
              aria-label={`Preview ${entry.name} ${entry.version}`}
              onClick={() => state.open(entry)}
            >
              Preview package
            </Button>
          </Card>
        ))}
      </div>
      {selected && (
        <Card className="space-y-3 p-4" aria-label={`${selected.name} preview`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">
              {selected.name} {selected.version}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => state.open(undefined)}>
              Close preview
            </Button>
          </div>
          {!release && !state.error && <p role="status">Loading package…</p>}
          {release && (
            <>
              <ul className="space-y-2">
                {release.manifest.contributions.map((item) => (
                  <li key={item.id} className="space-y-2">
                    <p className="text-sm">{item.title}</p>
                    {marketplaceNeedsSource(item) && (
                      <SourceFields
                        contribution={item}
                        binding={state.binding(item.id)}
                        bind={state.bind}
                      />
                    )}
                  </li>
                ))}
              </ul>
              {current?.draft ? (
                selected.draft?.digest === selected.digest ? (
                  <Button size="sm" disabled={!connected || busy} onClick={() => review(current)}>
                    Review staged draft
                  </Button>
                ) : (
                  <p>Review or discard the existing draft before staging this package.</p>
                )
              ) : (
                <Button
                  size="sm"
                  disabled={!command || !connected || busy}
                  onClick={async () => {
                    if (command && (await stage(command))) state.reload()
                  }}
                >
                  {selected.installed && selected.installed.digest !== selected.digest
                    ? 'Stage update'
                    : 'Stage package'}
                </Button>
              )}
              {release.dashboard && snapshot?.dashboardsSupported && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm">Dashboard template: {release.dashboard.title}</p>
                  {current?.enabled && selected.installed?.digest === selected.digest ? (
                    dashboard?.digest === selected.digest && dashboard.added ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => host.navigate({ viewId: 'dashboards' })}
                      >
                        Open dashboards
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!connected || adding}
                        onClick={async () => {
                          setAdding(true)
                          try {
                            await addMarketplaceDashboard(
                              request,
                              release,
                              snapshot.studioDataSourcesSupported === true,
                            )
                            setDashboard({ digest: selected.digest, added: true })
                          } catch (cause) {
                            setDashboard({
                              digest: selected.digest,
                              issue: cause instanceof Error ? cause.message : String(cause),
                            })
                          } finally {
                            setAdding(false)
                          }
                        }}
                      >
                        Add dashboard
                      </Button>
                    )
                  ) : (
                    <p className="text-sm">Install and enable this release to add its dashboard.</p>
                  )}
                  {dashboard?.digest === selected.digest && dashboard.issue && (
                    <p role="alert">{dashboard.issue}</p>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </section>
  )
}

function SourceFields({
  contribution,
  binding,
  bind,
}: {
  contribution: MarketplaceSourceContribution
  binding?: MarketplaceBinding
  bind: (binding: MarketplaceBinding) => void
}) {
  const { request, connected, snapshot } = useWorkspace()
  const taskId = binding?.taskId ?? ''
  const sources = useMarketplaceSources(request, taskId, connected)
  if (contribution.kind === 'cli') {
    const repositories = snapshot?.workspace.repositories ?? []
    return (
      <div className="space-y-2">
        <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
          {contribution.command}
        </pre>
        <label className="grid gap-1 text-sm">
          Project
          <select
            className="max-w-72 rounded-md border bg-background p-2"
            disabled={!connected}
            value={binding?.source ?? ''}
            onChange={(event) =>
              bind({ contributionId: contribution.id, source: event.currentTarget.value })
            }
          >
            <option value="">Choose project</option>
            {!repositories.some(({ id }) => id === SCRATCH_PROJECT_ID) && (
              <option value={SCRATCH_PROJECT_ID}>No Project</option>
            )}
            {repositories.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
    )
  }
  const items =
    contribution.kind === 'tool'
      ? sources?.data?.servers.map((name) => ({ id: name, title: name }))
      : sources?.data?.apps
  const id = contribution.id
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="grid gap-1">
        Source thread for {contribution.title}
        <select
          className="max-w-72 rounded-md border bg-background p-2"
          disabled={!connected}
          value={taskId}
          onChange={(event) => bind({ contributionId: id, taskId: event.target.value, source: '' })}
        >
          <option value="">Choose thread</option>
          {snapshot?.workspace.tasks
            .filter((task) => !task.archived && !task.archivedAt)
            .map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
        </select>
      </label>
      <label className="grid gap-1">
        {marketplaceContributionSource(contribution)}
        <select
          className="max-w-72 rounded-md border bg-background p-2"
          disabled={!connected || !items?.length}
          value={binding?.source ?? ''}
          onChange={(event) => bind({ contributionId: id, taskId, source: event.target.value })}
        >
          <option value="">{items?.length === 0 ? 'No sources available' : 'Choose source'}</option>
          {items?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      {sources?.error && <p role="alert">{sources.error}</p>}
    </div>
  )
}
