import type { ReactNode } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { useRuntimeSources, useWorkspace, WorkspaceScope } from '@dovo/studio-core'
import { ChoicePicker } from '@dovo/studio-ui'

/** A settings page for one computer, with a picker like Codex's host selector. Pages list
 * every saved computer; the active one is selected first. */
export function HostPage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const sources = useRuntimeSources()
  const { activeRuntimeId } = useWorkspace()
  const [chosen, setChosen] = useApplicationState('')
  const source =
    sources.find((entry) => entry.profile.id === chosen) ??
    sources.find((entry) => entry.profile.id === activeRuntimeId) ??
    sources[0]
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="studio-page-header flex shrink-0 flex-wrap items-end justify-between gap-3 border-b">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {sources.length > 1 && source && (
          <ChoicePicker
            aria-label="Computer"
            className="h-8 min-w-48 rounded-md px-2 text-xs"
            value={source.profile.id}
            onValueChange={setChosen}
          >
            {sources.map((entry) => (
              <option key={entry.profile.id} value={entry.profile.id}>
                {entry.name}
                {entry.connected ? '' : ' · Offline'}
              </option>
            ))}
          </ChoicePicker>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {!source ? (
            <p className="text-xs text-muted-foreground">
              Connect a computer in Devices & runtime to change these settings.
            </p>
          ) : (
            <WorkspaceScope key={source.scope} profile={source.profile}>
              {!source.connected && (
                <p role="status" className="text-xs text-muted-foreground">
                  {source.name} is offline. Showing saved settings; reconnect it to make changes.
                </p>
              )}
              {children}
            </WorkspaceScope>
          )}
        </div>
      </div>
    </section>
  )
}
