import { useAppPreferences } from '@dovo/studio-core'
import { useState } from 'react'
import { accountServerAddresses, responses, ACCOUNT_DIRECTORY_URL } from '@dovo/protocol'
import { useAccount, useStudioHost, useRuntimeSources, useWorkspace } from '@dovo/studio-core'
import { Button, ChoicePicker } from '@dovo/studio-ui'
export function AccountPanel({ onPair }: { onPair: (address: string) => void }) {
  const host = useStudioHost()
  if (!host.accountStorage || !host.openExternalLink) return null
  return (
    <AccountPanelContent
      storage={host.accountStorage}
      open={host.openExternalLink}
      onPair={onPair}
    />
  )
}
function AccountPanelContent({
  storage,
  open,
  onPair,
}: {
  storage: NonNullable<ReturnType<typeof useStudioHost>['accountStorage']>
  open: (url: string) => Promise<void>
  onPair: (address: string) => void
}) {
  const services = useAppPreferences()
  const { client, directory, login, busy, error, loaded, deletionPending } = useAccount(
    storage,
    open,
    services,
  )
  const sources = useRuntimeSources()
  const { snapshot, request, connected, activeRuntimeId, runtimeRegistry, refreshRuntime } =
    useWorkspace()
  const [internetBusy, setInternetBusy] = useState(false)
  const [internetError, setInternetError] = useState('')
  const setInternet = async (enabled: boolean) => {
    setInternetBusy(true)
    setInternetError('')
    try {
      if (enabled && client.origin !== ACCOUNT_DIRECTORY_URL && !snapshot?.internet?.origin)
        throw new Error('Update this computer before using a custom Connect URL')
      if (enabled)
        await client.enableInternet((accountToken) =>
          request(
            '/api/runtime/internet',
            { enabled, accountToken, origin: client.origin },
            responses.internetStatus,
          ),
        )
      else {
        await request('/api/runtime/internet', { enabled }, responses.internetStatus)
        if (directory) await client.refresh()
      }
      const profile = runtimeRegistry.profiles.find((item) => item.id === activeRuntimeId)
      if (profile) await refreshRuntime(profile)
    } catch (error) {
      setInternetError(error instanceof Error ? error.message : 'Could not change Dovo Connect')
    } finally {
      setInternetBusy(false)
    }
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selected, setSelected] = useState<Record<string, string>>({})
  return (
    <section className="space-y-3 rounded-md border p-4" aria-label="Dovo account">
      <div>
        <h2 className="text-sm font-medium">
          {directory ? `Signed in as ${directory.user.name}` : 'Your computers, across devices'}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Enable Dovo Connect to access this computer from your phone using the same account. LAN /
          VPN pairing stays separate and works without sign-in.
        </p>
      </div>
      {snapshot?.owner && snapshot.internet && (
        <div className="space-y-2 border-t pt-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={snapshot.internet.enabled}
              disabled={
                busy || internetBusy || !connected || (!directory && !snapshot.internet.enabled)
              }
              onChange={(event) => void setInternet(event.target.checked)}
            />
            Enable Dovo Connect
          </label>
          <p className="text-xs text-muted-foreground">
            {snapshot.internet.enabled
              ? snapshot.internet.connected
                ? 'Available to devices signed in to your account. No pairing code needed.'
                : 'Connecting to Dovo Connect…'
              : 'Sign in on both devices, then enable internet access here. No network setup needed.'}{' '}
            Connections are encrypted between your devices; Dovo relay is used when a direct
            internet connection is unavailable. Separately paired LAN / VPN connections take
            priority.
          </p>
          {(internetError || snapshot.internet.error) && (
            <p role="alert" className="text-xs text-destructive">
              {internetError || snapshot.internet.error}
            </p>
          )}
        </div>
      )}
      {!!error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {login ? (
        <div className="space-y-2">
          <p role="status" className="text-sm">
            Confirm code <strong>{login.code}</strong> in your browser.
          </p>
          <Button variant="outline" onClick={client.cancel}>
            Cancel sign-in
          </Button>
        </div>
      ) : deletionPending ? (
        <Button disabled={busy} onClick={() => void client.deleteAccount()}>
          Retry account deletion
        </Button>
      ) : (
        <div className="flex gap-2">
          {directory ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => void client.refresh()}>
                Refresh linked computers
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void client.signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <Button disabled={busy || !loaded} onClick={() => void client.signIn()}>
              {busy ? 'Connecting…' : 'Sign in'}
            </Button>
          )}
          {error && (
            <Button variant="outline" disabled={busy} onClick={() => void client.load()}>
              Retry account
            </Button>
          )}
        </div>
      )}
      {directory && !deletionPending && (
        <div className="space-y-2">
          {confirmDelete ? (
            <>
              <p role="alert" className="text-sm">
                Permanently delete your hosted identity, linked computers and notification
                permissions on all devices? Files, threads and separate pairings on your computers
                remain. Service backups expire within 14 days. This cannot be undone.
              </p>
              <Button disabled={busy} onClick={() => void client.deleteAccount()}>
                Delete account permanently
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete account
            </Button>
          )}
        </div>
      )}
      {directory && !deletionPending && (
        <details className="space-y-3 border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium">Manage linked computers</summary>
          {directory.servers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No computers linked yet. Enable Dovo Connect on a computer or link a separately paired
              computer below.
            </p>
          )}
          {directory.servers.map((server) => {
            const paired = sources.some(
              (source) =>
                source.profile.connection.runtimeId === server.id ||
                source.snapshot?.runtimeId === server.id,
            )
            return (
              <div key={server.id} className="flex flex-wrap items-center gap-2 border-t pt-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{server.name}</p>
                  <p className="break-all text-xs text-muted-foreground">
                    {server.internet
                      ? server.internet.online
                        ? 'Dovo Connect · Online'
                        : 'Dovo Connect · Offline'
                      : server.address}
                  </p>
                </div>
                {server.internet ? (
                  <span className="text-xs text-muted-foreground">
                    Available in the Dovo mobile app
                  </span>
                ) : paired ? (
                  <span className="text-xs text-muted-foreground">Already paired</span>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => onPair(server.address)}>
                    Pair computer
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void client.unlink(server.id)}
                >
                  {server.internet ? 'Disable Dovo Connect' : 'Unlink'}
                </Button>
              </div>
            )
          })}
          {sources
            .filter(
              (source) =>
                source.connected &&
                source.snapshot?.runtimeId &&
                !directory.servers.some((server) => server.id === source.snapshot?.runtimeId),
            )
            .map((source) => {
              const id = source.snapshot?.runtimeId
              const addresses = accountServerAddresses(source.profile.connection, source.snapshot)
              const address = addresses.includes(selected[source.profile.id])
                ? selected[source.profile.id]
                : addresses[0]
              return (
                <div key={source.profile.id} className="space-y-2 border-t pt-3">
                  {addresses.length > 1 && (
                    <ChoicePicker
                      aria-label={`Address for ${source.name}`}
                      value={address}
                      disabled={busy}
                      onValueChange={(value) =>
                        setSelected((current) => ({ ...current, [source.profile.id]: value }))
                      }
                    >
                      {addresses.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </ChoicePicker>
                  )}
                  {address ? (
                    <>
                      <p className="break-all text-xs text-muted-foreground">{address}</p>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          if (id) void client.link({ id, name: source.name, address })
                        }}
                      >
                        Link {source.name} to account
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Enable LAN/VPN access on {source.name} before linking it.
                    </p>
                  )}
                </div>
              )
            })}
        </details>
      )}
    </section>
  )
}
