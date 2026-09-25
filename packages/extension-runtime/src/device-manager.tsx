import { DesktopNetwork } from './desktop-network'
import { PairingGuide } from './pairing-guide'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { responses, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
/** `connectPhone` starts pairing immediately, for entry points that exist only to pair. */
export function DeviceManager({ connectPhone = false }: { connectPhone?: boolean }) {
  const { snapshot, request, connected, activeRuntimeId, runtimeRegistry, refreshRuntime } =
    useWorkspace()
  const profile = runtimeRegistry.profiles.find((entry) => entry.id === activeRuntimeId)
  const [code, setCode] = useApplicationState<{
      code: string
      addresses?: { name: string; address: string }[]
      expiresAt: string
    } | null>(null),
    [error, setError] = useApplicationState(''),
    [notice, setNotice] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  const act = (action: () => Promise<unknown>) => {
    if (!connected || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    void action()
      .then(async () => {
        if (profile) await refreshRuntime(profile)
      })
      .catch((error) => setError(String(error)))
      .finally(() => {
        pending.current = false
        setBusy(false)
      })
  }
  const started = useRef(false)
  useEffect(() => {
    if (!connectPhone || started.current || !connected || !snapshot?.owner) return
    started.current = true
    act(async () => setCode(await request('/api/pair/code', {}, responses.pairCode)))
  }, [connectPhone, connected, snapshot?.owner])
  return (
    <article className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Trusted devices</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Phones and clients allowed to access this host.
          </p>
        </div>
        {snapshot?.owner && (
          <Button
            size="sm"
            disabled={!connected || busy}
            onClick={() =>
              act(async () => setCode(await request('/api/pair/code', {}, responses.pairCode)))
            }
          >
            {code ? 'Generate new pairing code' : 'Connect your phone'}
          </Button>
        )}
      </div>
      {snapshot?.owner && (
        <DesktopNetwork
          onChanged={async () => {
            setCode(await request('/api/pair/code', {}, responses.pairCode))
            if (profile) await refreshRuntime(profile)
          }}
        />
      )}
      {snapshot?.pendingDevices.map((device) => (
        <div key={device.id} className="flex items-center justify-between gap-3 rounded border p-3">
          <span className="text-xs">
            {device.name} requests full access to files, agents, and terminal commands on this
            computer
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!connected || busy}
              onClick={() =>
                act(() =>
                  request(
                    '/api/pair/approve',
                    {
                      id: device.id,
                      allow: true,
                    },
                    responses.ok,
                  ).then(() => {
                    setCode(null)
                    setNotice('Approval sent. Finish saving the connection on your phone.')
                  }),
                )
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!connected || busy}
              onClick={() =>
                act(() =>
                  request(
                    '/api/pair/approve',
                    {
                      id: device.id,
                      allow: false,
                    },
                    responses.ok,
                  ).then(() => {
                    setCode(null)
                    setNotice(
                      'Pairing request denied. Generate a new code if you want to try again.',
                    )
                  }),
                )
              }
            >
              Deny
            </Button>
          </div>
        </div>
      ))}
      {code && (
        <PairingGuide
          key={code.code}
          code={code}
          fallbackAddress={profile?.connection.address}
          pending={!!snapshot?.pendingDevices.length}
        />
      )}

      {snapshot?.devices.map((device) => (
        <div
          key={device.id}
          className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-xs"
        >
          <span className="min-w-0 break-words">
            {device.name} · {device.revokedAt ? 'Revoked' : 'Trusted'}
          </span>
          {snapshot.owner && !device.revokedAt && (
            <Button
              size="sm"
              variant="ghost"
              title="Remove this device’s permission to access the host"
              disabled={!connected || busy}
              onClick={() =>
                act(() =>
                  request(
                    '/api/devices/revoke',
                    {
                      id: device.id,
                    },
                    responses.ok,
                  ),
                )
              }
            >
              Revoke
            </Button>
          )}
        </div>
      ))}
      {!snapshot?.devices.length && (
        <p className="text-xs text-muted-foreground">
          No paired devices yet. Generate a code on the desktop host, then enter it on the
          connecting device.
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  )
}
