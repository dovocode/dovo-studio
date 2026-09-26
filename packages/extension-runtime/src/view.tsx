import { useApplicationState } from '@dovo/studio-core/state'
import type { RuntimeProfile } from '@dovo/studio-core'
import { useRuntimeSources, useStudioHost, WorkspaceScope } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'
import { PairingClient } from './pairing-client'
import { DeviceManager } from './device-manager'
export default function RuntimeView() {
  const sources = useRuntimeSources()
  const studio = useStudioHost()
  const [managing, setManaging] = useApplicationState<RuntimeProfile | null>(null)
  const [pairingPhone, setPairingPhone] = useApplicationState(false)
  // Phones pair with a computer this app owns: the local desktop runtime or an owned server.
  const host = sources.find((entry) => entry.connected && entry.snapshot?.owner)
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
          {host && (
            <article className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
              <div className="min-w-0">
                <h2 className="text-sm font-medium">Connect your phone</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Follow and answer tasks from the Dovo iPhone or Android app. Scan a QR code or
                  type an eight-digit code.
                </p>
              </div>
              <Button onClick={() => setPairingPhone(true)}>Connect your phone</Button>
            </article>
          )}
          <PairingClient onManage={setManaging} />
          <p className="text-xs leading-6 text-muted-foreground">
            Tasks, projects and tools appear together across your computers. Each item keeps its own
            execution host. Connect using a reachable LAN, Tailscale or NetBird address.
          </p>
        </div>
      </div>
      {pairingPhone && host && (
        <Dialog open onOpenChange={(open) => !open && setPairingPhone(false)}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Connect your phone</DialogTitle>
              <DialogDescription>
                Pairing with {host.name}. Keep this window open until your phone finishes.
              </DialogDescription>
            </DialogHeader>
            <WorkspaceScope profile={host.profile}>
              <DeviceManager connectPhone />
            </WorkspaceScope>
          </DialogContent>
        </Dialog>
      )}
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
                {/* Per-computer settings live on their own pages, like Codex and T3 Code. */}
                <div className="flex flex-wrap gap-2">
                  {[
                    ['task-defaults', 'Task defaults'],
                    ['commands', 'CLI commands & shell'],
                    ['activity', 'Activity & message history'],
                  ].map(([viewId, label]) => (
                    <Button
                      key={viewId}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setManaging(null)
                        studio.navigate({ viewId })
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
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
