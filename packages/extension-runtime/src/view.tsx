import { ServiceUrlSettings } from './service-url-settings'
import { useEffect, useRef, useState } from 'react'
import { AccountPanel } from './account-panel'
import { ComputerSshSettings } from './computer-ssh-settings'
import { RuntimeIconSettings } from './runtime-icon-settings'
import { runtimeSettings } from './settings-views'
import { RuntimeDiagnosticsPanel } from './runtime-diagnostics'
import { SettingsPage } from '@dovo/studio-ui'
import { Schema } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { resolveThreadRuntime } from '@dovo/protocol'
import type { StudioViewProps, RuntimeProfile } from '@dovo/studio-core'
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
export default function RuntimeView({ threadConnection }: StudioViewProps) {
  const sources = useRuntimeSources()
  const studio = useStudioHost()
  const { runtimeRegistry, runtimes } = useWorkspace()
  const resumed = useRef<StudioViewProps['threadConnection']>(undefined)
  const pairedTarget = threadConnection?.runtimeIdentity
    ? resolveThreadRuntime(threadConnection, runtimeRegistry.profiles, runtimes)
    : undefined
  useEffect(() => {
    if (!threadConnection || !pairedTarget || resumed.current === threadConnection) return
    resumed.current = threadConnection
    studio.openThread?.({ ...threadConnection, runtimeId: pairedTarget.id })
  }, [threadConnection, pairedTarget, studio])
  const [discovered, setDiscovered] = useState<{ address: string } | undefined>(undefined)
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
    <SettingsPage
      title="Devices & runtime"
      description="Connect computers and phones, manage trusted devices and check runtime health."
      storageInfo={
        <span>Computer settings stay on each computer. Service URLs use Save on this device.</span>
      }
    >
      {threadConnection && (
        <section className="studio-settings-group space-y-3 border-b border-border/50 pb-5">
          <h2 className="text-sm font-semibold tracking-tight">
            Pair computer to open {threadConnection.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            Pair the computer running this thread with its LAN/VPN address and pairing code. The
            thread will open after its computer identity is verified.
          </p>
          <Button onClick={() => setDiscovered({ address: '' })}>Pair thread computer</Button>
          {!threadConnection.runtimeIdentity && (
            <>
              <p className="text-xs text-muted-foreground">
                This older thread link has no computer identity. Choose its owning computer
                explicitly after pairing.
              </p>
              {runtimeRegistry.profiles.map((profile) => (
                <Button
                  key={profile.id}
                  onClick={() =>
                    studio.openThread?.({ ...threadConnection, runtimeId: profile.id })
                  }
                >
                  Open on {profile.name}
                </Button>
              ))}
            </>
          )}
          <Button
            variant="outline"
            onClick={() =>
              threadConnection.parent
                ? studio.openThread?.(threadConnection.parent)
                : studio.navigate({ viewId: 'tasks' })
            }
          >
            Cancel
          </Button>
        </section>
      )}
      <WindowsRuntimeSettings />
      {sources
        .filter((entry) => entry.snapshot?.lastCrash)
        .map((entry) => (
          <LastCrashNotice key={entry.profile.id} source={entry} />
        ))}
      <PairingClient onManage={setManaging} discovered={discovered} />
      {host && (
        <section className="studio-settings-group flex flex-wrap items-center justify-between gap-3 border-y border-border/50 py-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">Connect your phone</h2>
            <p className="mt-1 max-w-[62ch] text-[0.8125rem] leading-relaxed text-muted-foreground">
              Follow and answer threads from the Dovo iPhone or Android app. Scan a QR code or type
              an eight-digit code.
            </p>
          </div>
          <Button variant="outline" onClick={() => setPairingPhone(host.profile)}>
            Connect your phone
          </Button>
        </section>
      )}
      <ServiceUrlSettings />
      <AccountPanel onPair={(address) => setDiscovered({ address })} />
      <p className="text-xs leading-6 text-muted-foreground">
        Threads and projects appear together; each runs on its own computer. Use a reachable LAN,
        Tailscale or NetBird address. HTTP and optional HTTPS are supported.
      </p>
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
              <>
                <RuntimeIconSettings source={source} />
                <ComputerSshSettings key={source.profile.id} source={source} />
                <WorkspaceScope profile={managing}>
                  <DeviceManager key={managing.id} />
                  {source.snapshot?.owner && <RuntimeDiagnosticsPanel />}
                  {/* Per-computer settings live on their own pages, like Codex and T3 Code. */}
                  <section className="space-y-3 border-t pt-4">
                    <h2 className="text-sm font-semibold">Computer settings</h2>
                    <p className="text-xs text-muted-foreground">
                      Open a page to change settings saved on this computer.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[...runtimeSettings]
                        .sort((a, b) => a.order - b.order)
                        .map(({ id: viewId, title: label }) => (
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
                  </section>
                </WorkspaceScope>
              </>
            ) : (
              <Button onClick={() => setManaging(null)}>Close</Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </SettingsPage>
  )
}

/** A runtime that exited on an uncaught exception reports why on its next start. */
function LastCrashNotice({ source }: { source: ReturnType<typeof useRuntimeSources>[number] }) {
  const crash = source.snapshot?.lastCrash
  const { readRuntime, refreshRuntime } = useWorkspace()
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  if (!crash) return null
  return (
    <article
      role="alert"
      className="flex flex-wrap items-start justify-between gap-3 border-l-2 border-status-warning/50 py-1 pl-4"
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-medium">{source.name} restarted after an unexpected error</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(crash.at).toLocaleString()} · threads that were running were interrupted and
          continued or stopped according to the restart policy.
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">
          {crash.message}
        </pre>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !source.connected}
        onClick={() => {
          setBusy(true)
          setError('')
          void readRuntime(
            source.profile,
            '/api/runtime/crash/dismiss',
            {},
            Schema.Struct({ ok: Schema.Boolean }),
            'POST',
          )
            .then(() => refreshRuntime(source.profile))
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Dismissing…' : 'Dismiss'}
      </Button>
    </article>
  )
}
