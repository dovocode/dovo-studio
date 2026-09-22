import { useRef, useState } from 'react'
import { responses, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
export function DeviceManager() {
  const { snapshot, request, connected, activeRuntimeId, runtimeRegistry, refreshRuntime } =
    useWorkspace()
  const profile = runtimeRegistry.profiles.find((entry) => entry.id === activeRuntimeId)
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const act = (action: () => Promise<unknown>) => {
    if (!connected || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
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
  return (
    <article className="space-y-4 rounded-lg border p-5">
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
            Generate pairing code
          </Button>
        )}
      </div>
      {code && (
        <div className="rounded border bg-card p-4">
          <p className="font-mono text-2xl tracking-widest">{code.code}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Single use · host approval required · expires{' '}
            {new Date(code.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      )}
      {snapshot?.pendingDevices.map((device) => (
        <div key={device.id} className="flex items-center justify-between gap-3 rounded border p-3">
          <span className="text-xs">{device.name} wants to connect</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!connected || busy}
              onClick={() =>
                act(() =>
                  request('/api/pair/approve', { id: device.id, allow: true }, responses.ok),
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
                  request('/api/pair/approve', { id: device.id, allow: false }, responses.ok),
                )
              }
            >
              Deny
            </Button>
          </div>
        </div>
      ))}
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
                act(() => request('/api/devices/revoke', { id: device.id }, responses.ok))
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
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  )
}
