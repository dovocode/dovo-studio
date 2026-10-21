import { useRef, useState } from 'react'
import { responses } from '@dovo/protocol'
import { useAccount, useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

export function ConnectSettings() {
  const host = useStudioHost()
  if (!host.accountStorage || !host.openExternalLink) return null
  return <ConnectSettingsContent storage={host.accountStorage} open={host.openExternalLink} />
}

function ConnectSettingsContent({
  storage,
  open,
}: {
  storage: NonNullable<ReturnType<typeof useStudioHost>['accountStorage']>
  open: (url: string) => Promise<void>
}) {
  const { client, directory, login, loaded, busy, error, deletionPending } = useAccount(
    storage,
    open,
  )
  const { snapshot, request, connected, activeRuntimeId, runtimeRegistry, refreshRuntime } =
    useWorkspace()
  const profile = runtimeRegistry.profiles.find((item) => item.id === activeRuntimeId)
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const pending = useRef(false)
  if (!profile) return null
  const name = profile.name
  const enable = async () => {
    if (pending.current || !snapshot?.runtimeId) return
    pending.current = true
    setSaving(true)
    setFailure('')
    try {
      await client.enablePairedInternet(
        snapshot.runtimeId,
        (session) =>
          request(
            '/api/runtime/internet/setup',
            { session, consent: true, relay: 'dovo' },
            responses.internetSetup,
          ),
        (id, grant) =>
          request('/api/runtime/internet/complete', { id, grant }, responses.internetStatus),
      )
      setConfirm(false)
      await refreshRuntime(profile)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not enable Dovo Connect')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label={`Dovo Connect for ${name}`}>
      <h2 className="text-sm font-medium">Dovo Connect + relay</h2>
      <p className="text-xs text-muted-foreground">
        {snapshot?.internet?.enabled
          ? snapshot.internet.connected
            ? 'Enabled · Online. Same-account devices can connect directly or through encrypted TURN relay.'
            : 'Enabled · Connecting to Dovo Connect…'
          : 'Enable account access and encrypted TURN fallback on this computer. LAN / VPN pairing stays available.'}
      </p>
      {snapshot?.internetSetupSupported === undefined ? (
        <p className="text-xs text-muted-foreground">
          Update Dovo on this computer to enable Connect from a paired device.
        </p>
      ) : (
        !snapshot.internet?.enabled &&
        snapshot.internetSetupSupported && (
          <>
            {login ? (
              <>
                <p role="status" className="text-sm">
                  Confirm code {login.code} in your browser.
                </p>
                <Button onClick={client.cancel}>Cancel sign-in</Button>
              </>
            ) : !directory ? (
              <Button disabled={!loaded || busy} onClick={() => void client.signIn()}>
                Sign in to enable Dovo Connect
              </Button>
            ) : confirm ? (
              <>
                <p role="alert" className="text-sm">
                  Enable Dovo Connect on {name} for {directory.user.name}? Devices signed in to this
                  account will have access to files, agents and terminal commands on this computer.
                  Encrypted traffic may pass through Dovo TURN servers when a direct connection
                  fails.
                </p>
                <Button
                  disabled={!connected || busy || saving || deletionPending}
                  onClick={() => void enable()}
                >
                  {saving ? 'Enabling…' : 'Confirm Connect + relay'}
                </Button>
                <Button variant="ghost" disabled={saving} onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                disabled={!connected || busy || saving || deletionPending}
                onClick={() => setConfirm(true)}
              >
                Enable Dovo Connect + relay
              </Button>
            )}
          </>
        )
      )}
      {!!(failure || error || snapshot?.internet?.error) && (
        <p role="alert" className="text-xs text-destructive">
          {failure || error || snapshot?.internet?.error}
        </p>
      )}
    </section>
  )
}
