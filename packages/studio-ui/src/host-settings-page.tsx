import { PageHeader } from './page-header'
import { useEffect, useRef, type ReactNode } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useConfirmSettingsNavigation,
  useRuntimeSources,
  useWorkspace,
  WorkspaceScope,
} from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'
import { Button } from './components/ui/button'

/** A settings page for one computer, with a picker like Codex's host selector. Pages list
 * every saved computer; a linked host takes precedence over the active one. */
export function HostSettingsPage({
  title,
  description,
  initialRuntimeId,
  children,
  localSettings,
}: {
  title: string
  description: string
  initialRuntimeId?: string
  children: ReactNode
  localSettings?: ReactNode
}) {
  const sources = useRuntimeSources()
  const confirmNavigation = useConfirmSettingsNavigation()
  const { activeRuntimeId, refreshRuntime } = useWorkspace()
  const [chosen, setChosen] = useApplicationState(initialRuntimeId ?? '')
  const [refreshing, setRefreshing] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const generation = useRef(0)
  useEffect(() => setChosen(initialRuntimeId ?? ''), [initialRuntimeId, setChosen])
  const source =
    sources.find((entry) => entry.profile.id === chosen) ??
    sources.find((entry) => entry.profile.id === activeRuntimeId) ??
    sources[0]
  useEffect(() => {
    generation.current++
    setRefreshing(false)
    setError('')
    return () => {
      generation.current++
    }
  }, [source?.scope, setRefreshing, setError])
  const retry = async () => {
    if (!source || refreshing) return
    const current = generation.current
    setRefreshing(true)
    setError('')
    try {
      await refreshRuntime(source.profile)
    } catch (failure) {
      if (current === generation.current)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (current === generation.current) setRefreshing(false)
    }
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} description={description}>
        {source && (
          <div className="flex w-80 min-w-0 max-w-full items-center gap-2">
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
              title={`${localSettings ? 'Computer settings on' : 'Saved on'} ${source.name}`}
            >
              {localSettings ? 'Computer settings on' : 'Saved on'} {source.name}
            </span>
            {sources.length > 1 && (
              <ChoicePicker
                aria-label="Computer"
                className="h-8 w-48 min-w-0 max-w-[65%] rounded-md px-2 text-xs"
                value={source.profile.id}
                disabled={refreshing}
                onValueChange={(value) => {
                  if (confirmNavigation()) setChosen(value)
                }}
              >
                {sources.map((entry) => (
                  <option key={entry.profile.id} value={entry.profile.id}>
                    {entry.name}
                    {entry.connected ? '' : ' · Offline'}
                  </option>
                ))}
              </ChoicePicker>
            )}
          </div>
        )}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {localSettings}
          {!source ? (
            <p className="text-xs text-muted-foreground">
              Connect a computer in Devices & runtime to change these settings.
            </p>
          ) : (
            <WorkspaceScope key={source.scope} profile={source.profile}>
              {!source.connected && (
                <div className="space-y-3">
                  <p role="status" className="text-xs text-muted-foreground">
                    {source.name} is offline. Reconnect it to view or change these settings.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={refreshing}
                    onClick={() => void retry()}
                  >
                    {refreshing ? 'Connecting…' : 'Retry connection'}
                  </Button>
                  {error && (
                    <p role="alert" className="text-xs text-destructive">
                      {error}
                    </p>
                  )}
                </div>
              )}
              {source.connected && children}
            </WorkspaceScope>
          )}
        </div>
      </div>
    </section>
  )
}
