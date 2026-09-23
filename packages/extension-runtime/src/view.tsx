import { RuntimePreferences } from './runtime-preferences'
import { useApplicationState } from '@dovo/studio-core/state'
import type { RuntimeProfile } from '@dovo/studio-core'
import { useRuntimeSources, WorkspaceScope } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'
import { ActivityLog } from './activity'
import { CommandSettings } from './command-settings'
import { PairingClient } from './pairing-client'
import { DeviceManager } from './device-manager'
export default function RuntimeView() {
  const sources = useRuntimeSources()
  const [managing, setManaging] = useApplicationState<RuntimeProfile | null>(null)
  const source = sources.find(
    (entry) =>
      entry.profile.id === managing?.id &&
      entry.profile.connection.token === managing.connection.token &&
      entry.profile.connection.address === managing.connection.address,
  )
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="studio-page-header shrink-0 border-b">
        <h1 className="text-lg font-semibold tracking-tight">Devices & runtime</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Manage every connected computer in one place.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          <PairingClient onManage={setManaging} />
          <p className="text-xs leading-6 text-muted-foreground">
            Tasks, projects and tools appear together across your computers. Each item keeps its own
            execution host. Connect using a reachable LAN, Tailscale or NetBird address.
          </p>
        </div>
      </div>
      {managing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setManaging(null)
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{source?.name ?? managing.name}</DialogTitle>
              <DialogDescription>
                {source
                  ? `${source.connected ? 'Online' : 'Offline'} · ${source.profile.connection.address}`
                  : 'This computer connection changed. Reopen its settings to continue.'}
              </DialogDescription>
            </DialogHeader>
            {source ? (
              <WorkspaceScope profile={managing}>
                <DeviceManager />
                <RuntimePreferences />
                <HostTools />
              </WorkspaceScope>
            ) : (
              <Button onClick={() => setManaging(null)}>Close</Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
function HostTools() {
  const [panel, setPanel] = useApplicationState<'commands' | 'activity' | null>(null)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={panel === 'commands' ? 'secondary' : 'outline'}
          onClick={() => setPanel(panel === 'commands' ? null : 'commands')}
        >
          CLI commands & shell
        </Button>
        <Button
          variant={panel === 'activity' ? 'secondary' : 'outline'}
          onClick={() => setPanel(panel === 'activity' ? null : 'activity')}
        >
          Activity & message history
        </Button>
      </div>
      {panel === 'commands' ? <CommandSettings /> : panel === 'activity' ? <ActivityLog /> : null}
    </div>
  )
}
