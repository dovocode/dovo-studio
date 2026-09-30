import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  createRuntimeUpgradeManager,
  runtimeUpdate,
  runtimeUpgradeBlocked,
  type RuntimeUpgradeEntry,
} from '@dovo/protocol'
import { Button, MessageResponse } from '@dovo/studio-ui'
import { useWorkspace } from '@dovo/studio-core'

export function ComputerUpdates() {
  const { runtimes, refreshRuntime } = useWorkspace()
  const current = useRef({ runtimes, refreshRuntime })
  current.current = { runtimes, refreshRuntime }
  const [manager] = useState(() =>
    createRuntimeUpgradeManager({
      entries: () => current.current.runtimes,
      refreshed: (entry) => current.current.refreshRuntime(entry.profile),
    }),
  )
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot)
  useEffect(() => {
    void manager.check()
    const timer = setInterval(() => void manager.poll(), 3000)
    return () => {
      clearInterval(timer)
    }
  }, [manager])
  const eligible = (entry: RuntimeUpgradeEntry) => {
    const status = state.statuses[entry.profile.id]?.status
    return (
      !runtimeUpgradeBlocked(entry) &&
      runtimeUpdate(entry.snapshot, state.releases).available &&
      !['queued', 'downloading', 'installing', 'downloaded'].includes(status ?? '')
    )
  }
  const selected = runtimes
    .filter((entry) => state.selected.includes(entry.profile.id) && eligible(entry))
    .map((entry) => entry.profile.id)
  const ready = runtimes
    .filter(
      (entry) =>
        state.selected.includes(entry.profile.id) &&
        !runtimeUpgradeBlocked(entry) &&
        state.statuses[entry.profile.id]?.status === 'downloaded',
    )
    .map((entry) => entry.profile.id)
  return (
    <section className="space-y-3 rounded-lg border bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Computer updates</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Update computers individually or select a batch. Desktop downloads wait for your restart
            choice.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={state.checking}
          onClick={() => void manager.check()}
        >
          {state.checking ? 'Checking…' : 'Check updates'}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
      <div className="divide-y">
        {runtimes.map((entry) => {
          const id = entry.profile.id,
            update = runtimeUpdate(entry.snapshot, state.releases)
          const desktop = entry.snapshot?.releaseDistribution === 'desktop'
          const blocked = runtimeUpgradeBlocked(entry),
            status = state.statuses[id]
          const downloading = status?.status === 'downloading'
          const running = ['queued', 'downloading', 'installing'].includes(status?.status ?? '')
          const downloaded = desktop && status?.status === 'downloaded'
          return (
            <div key={id} className="flex gap-3 py-3">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                aria-label={`Select ${entry.profile.name} for update`}
                checked={state.selected.includes(id)}
                disabled={
                  !!state.busy.length ||
                  (!eligible(entry) && !downloaded && !state.selected.includes(id))
                }
                onChange={() => manager.toggle(id)}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">
                  {entry.profile.name}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {desktop ? 'Desktop' : 'Server'}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {update.installed ?? 'Version unknown'}
                  {update.available
                    ? ` → ${update.latest?.version}`
                    : update.installed && state.releases
                      ? ' · Up to date'
                      : ''}
                </p>
                {update.available && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-primary">What’s new</summary>
                    <div className="my-2 max-h-40 overflow-y-auto">
                      <MessageResponse baseURL={update.latest?.url}>
                        {update.latest?.notes || 'Release notes are unavailable.'}
                      </MessageResponse>
                    </div>
                  </details>
                )}
                {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
                {running && (
                  <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
                    {downloading
                      ? `Downloading ${Math.round(status?.progress ?? 0)}%${status?.total ? ` · ${((status.transferred ?? 0) / 1048576).toFixed(1)} / ${(status.total / 1048576).toFixed(1)} MB` : ''}`
                      : status?.status === 'installing'
                        ? 'Installing and reconnecting…'
                        : 'Preparing update…'}
                    {downloading && (
                      <progress
                        className="mt-1 block h-1.5 w-full"
                        max={100}
                        value={status?.progress ?? 0}
                      />
                    )}
                  </div>
                )}
                {downloaded && (
                  <p role="status" className="text-xs text-primary">
                    Version {status?.version} downloaded. Restart when you’re ready.
                  </p>
                )}
                {status?.status === 'complete' && (
                  <p role="status" className="text-xs text-emerald-500">
                    Update complete
                  </p>
                )}
                {status?.error && (
                  <p role="alert" className="text-xs text-destructive">
                    {status.error}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {eligible(entry) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!state.busy.length}
                      onClick={() => void manager.start([id])}
                    >
                      {desktop ? 'Download update' : 'Update server'}
                    </Button>
                  )}
                  {downloaded && (
                    <Button
                      size="sm"
                      disabled={!!state.busy.length || !!blocked}
                      onClick={() => void manager.restart([id])}
                    >
                      Restart and install
                    </Button>
                  )}
                  {update.latest && blocked && (
                    <a
                      className="text-xs text-primary underline"
                      href={update.latest.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View release
                    </a>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!selected.length || !!state.busy.length}
          onClick={() => void manager.start(selected)}
        >
          {state.busy.length ? 'Starting updates…' : `Update selected (${selected.length})`}
        </Button>
        {!!ready.length && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!state.busy.length}
            onClick={() => void manager.restart(ready)}
          >
            Restart selected desktops ({ready.length})
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Servers install and restart after downloading. Desktop updates include their bundled server.
        Other installs show host upgrade guidance.
      </p>
    </section>
  )
}
