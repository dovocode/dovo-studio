import { PageHeader } from '@dovo/studio-ui'
import { Schema } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import type { RuntimeProfile } from '@dovo/studio-core'
import { useRuntimeSources, useStudioHost, useWorkspace, WorkspaceScope } from '@dovo/studio-core'
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
import { WindowsRuntimeSettings } from './windows-runtime'
export default function RuntimeView() {
  const sources = useRuntimeSources()
  const studio = useStudioHost()
  const [managing, setManaging] = useApplicationState<RuntimeProfile | null>(null)
  const [pairingPhone, setPairingPhone] = useApplicationState<RuntimeProfile | null>(null)
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
      <PageHeader
        title="Devices & runtime"
        description="Manage every connected computer in one place."
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          <WindowsRuntimeSettings />
          {sources
            .filter((entry) => entry.snapshot?.lastCrash)
            .map((entry) => (
              <LastCrashNotice key={entry.profile.id} source={entry} />
            ))}
          {host && (
            <article className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
              <div className="min-w-0">
                <h2 className="text-sm font-medium">Connect your phone</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Follow and answer tasks from the Dovo iPhone or Android app. Scan a QR code or
                  type an eight-digit code.
                </p>
              </div>
              <Button onClick={() => setPairingPhone(host.profile)}>Connect your phone</Button>
            </article>
          )}
          <PairingClient onManage={setManaging} />
          <p className="text-xs leading-6 text-muted-foreground">
            Tasks, projects and tools appear together across your computers. Each item keeps its own
            execution host. Connect using a reachable LAN, Tailscale or NetBird address.
          </p>
        </div>
      </div>
      {pairingPhone && (
        <Dialog open onOpenChange={(open) => !open && setPairingPhone(null)}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Connect your phone</DialogTitle>
              <DialogDescription>
                Pairing with{' '}
                {sources.find((entry) => entry.profile.id === pairingPhone.id)?.name ??
                  pairingPhone.name}
                . Keep this window open until your phone finishes.
              </DialogDescription>
            </DialogHeader>
            <WorkspaceScope profile={pairingPhone}>
              <DeviceManager key={pairingPhone.id} connectPhone />
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
                <DeviceManager key={managing.id} />
                {/* Per-computer settings live on their own pages, like Codex and T3 Code. */}
                <div className="flex flex-wrap gap-2">
                  {[
                    ['running-tasks', 'Running tasks'],
                    ['task-defaults', 'Task defaults'],
                    ['worktrees', 'Worktrees'],
                    ['commands', 'CLI commands & shell'],
                    ['activity', 'Activity & message history'],
                  ].map(([viewId, label]) => (
                    <Button
                      key={viewId}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setManaging(null)
                        studio.navigate({ viewId, entityId: managing.id })
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

/** A runtime that exited on an uncaught exception reports why on its next start. */
function LastCrashNotice({ source }: { source: ReturnType<typeof useRuntimeSources>[number] }) {
  const crash = source.snapshot?.lastCrash
  const { readRuntime, refreshRuntime } = useWorkspace()
  const [busy, setBusy] = useApplicationState(false)
  if (!crash) return null
  return (
    <article
      role="alert"
      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-amber-400/30 bg-amber-400/5 p-4"
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">{source.name} restarted after an unexpected error</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(crash.at).toLocaleString()} · tasks that were running were interrupted and
          continued or stopped according to the restart policy.
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">
          {crash.message}
        </pre>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !source.connected}
        onClick={() => {
          setBusy(true)
          void readRuntime(
            source.profile,
            '/api/runtime/crash/dismiss',
            {},
            Schema.Struct({ ok: Schema.Boolean }),
            'POST',
          )
            .then(() => refreshRuntime(source.profile))
            .catch((error: unknown) => console.error('Could not dismiss the crash record', error))
            .finally(() => setBusy(false))
        }}
      >
        Dismiss
      </Button>
    </article>
  )
}
