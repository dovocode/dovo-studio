import { PageHeader } from './page-header'
import { useEffect, type ReactNode } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useConfirmSettingsNavigation,
  useRuntimeSources,
  useWorkspace,
  WorkspaceScope,
} from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'

/** A settings page for one computer, with a picker like Codex's host selector. Pages list
 * every saved computer; a linked host takes precedence over the active one. */
export function HostSettingsPage({
  title,
  description,
  initialRuntimeId,
  children,
}: {
  title: string
  description: string
  initialRuntimeId?: string
  children: ReactNode
}) {
  const sources = useRuntimeSources()
  const confirmNavigation = useConfirmSettingsNavigation()
  const { activeRuntimeId } = useWorkspace()
  const [chosen, setChosen] = useApplicationState(initialRuntimeId ?? '')
  useEffect(() => setChosen(initialRuntimeId ?? ''), [initialRuntimeId, setChosen])
  const source =
    sources.find((entry) => entry.profile.id === chosen) ??
    sources.find((entry) => entry.profile.id === activeRuntimeId) ??
    sources[0]
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} description={description}>
        {source && (
          <span className="text-[11px] text-muted-foreground">Saved on {source.name}</span>
        )}
        {sources.length > 1 && source && (
          <ChoicePicker
            aria-label="Computer"
            className="h-8 min-w-48 rounded-md px-2 text-xs"
            value={source.profile.id}
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
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {!source ? (
            <p className="text-xs text-muted-foreground">
              Connect a computer in Devices & runtime to change these settings.
            </p>
          ) : (
            <WorkspaceScope key={source.scope} profile={source.profile}>
              {!source.connected && (
                <p role="status" className="text-xs text-muted-foreground">
                  {source.name} is offline. Reconnect it to view or change these settings.
                </p>
              )}
              {source.connected && children}
            </WorkspaceScope>
          )}
        </div>
      </div>
    </section>
  )
}
