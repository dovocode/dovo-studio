import { PAIRING_PROTOCOL_VERSION } from '@dovo/studio-core'
import { Effect } from 'effect'
import { runtimeRequestEffect } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import type { RuntimeProfile } from '@dovo/studio-core'
import { Monitor, Plus, Circle } from 'lucide-react'
import { responses, runtimeRequest, useWorkspace, startPolling } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormField,
  Input,
  cn,
} from '@dovo/studio-ui'
export function PairingClient({ onManage }: { onManage: (profile: RuntimeProfile) => void }) {
  const {
    connect,
    cancelPairing,
    runtimeRegistry,
    runtimes,
    refreshRuntime,
    forgetRuntime,
    retrySync,
    discardAndReload,
    pendingSync,
  } = useWorkspace()
  const [address, setAddress] = useApplicationState(''),
    [name, setName] = useApplicationState('My computer'),
    [code, setCode] = useApplicationState(''),
    [replaceId, setReplaceId] = useApplicationState<string | undefined>(undefined),
    [open, setOpen] = useApplicationState(false),
    [reloadOpen, setReloadOpen] = useApplicationState(false)
  const [pending, setPending] = useApplicationState<{
      id: string
      secret: string
      expiresAt: string
    } | null>(null),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const generation = useRef(0)
  const pairingPhase = useRef<'waiting' | 'cancelled' | 'saving'>('waiting')
  const connectRef = useRef(connect)
  connectRef.current = connect
  const cancel = () => {
    if (busy || pairingPhase.current === 'saving') return
    if (pending) {
      pairingPhase.current = 'cancelled'
      setBusy(true)
      void cancelPairing(address, pending)
        .then(() => {
          setPending(null)
          setOpen(false)
          setError('')
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setBusy(false))
      return
    }
    generation.current++
    setPending(null)
    setOpen(false)
    setBusy(false)
    setError('')
  }
  useEffect(() => {
    if (!pending) return
    pairingPhase.current = 'waiting'
    let stopped = false
    const poll = Effect.gen(function* () {
      if (Date.parse(pending.expiresAt) <= Date.now()) {
        setError('This pairing request expired. Generate a new code on the host.')
        setPending(null)
        return
      }
      if (pairingPhase.current !== 'waiting') return
      const result = yield* runtimeRequestEffect(
        null,
        address,
        '/api/pair/claim',
        {
          id: pending.id,
          secret: pending.secret,
        },
        responses.pairClaim,
      )
      if (stopped || pairingPhase.current !== 'waiting') return
      if (result.status === 'approved' && result.token) {
        pairingPhase.current = 'saving'
        setBusy(true)
        const token = result.token
        yield* Effect.tryPromise({
          try: () => connectRef.current({ address, token }, pending, replaceId),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(Effect.uninterruptible)
        pairingPhase.current = 'waiting'
        if (!stopped) {
          setPending(null)
          setOpen(false)
          setCode('')
          setError('')
        }
      } else if (result.status === 'denied') {
        setError('The host declined this device. Generate a new code to try again.')
        setPending(null)
      } else setError('')
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!stopped) setBusy(false)
        }),
      ),
    )
    const polling = startPolling(poll, {
      interval: 1500,
      onError: (error) => {
        if (pairingPhase.current === 'saving') pairingPhase.current = 'waiting'
        if (!stopped)
          setError(`Connection interrupted. Retrying until the code expires. ${error.message}`)
      },
    })
    const foreground = () => {
      if (document.visibilityState === 'visible') polling.refresh()
    }
    document.addEventListener('visibilitychange', foreground)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', foreground)
      void polling.stop()
    }
  }, [pending, address, replaceId])
  const act = async (work: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="space-y-4 rounded-md border bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Your computers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            All saved computers contribute to your unified workspace.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setError('')
            setReplaceId(undefined)
            setAddress('')
            setCode('')
            setOpen(true)
          }}
        >
          <Plus size={14} className="mr-1.5" />
          Connect computer
        </Button>
      </div>
      {!!runtimeRegistry.pendingPairings?.length && (
        <p role="status" className="text-xs text-muted-foreground">
          A connection is waiting to finish pairing. Keep the computer online; recovery retries when
          you return to this window.
        </p>
      )}
      {pendingSync && (
        <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div>
            <h3 className="text-xs font-medium">Unsent changes</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Edits for{' '}
              {runtimeRegistry.profiles.find((entry) => entry.id === runtimeRegistry.activeId)
                ?.name ?? 'this computer'}{' '}
              stay on this device until they sync. Retry after reconnecting, or reload the host
              version to resolve a conflicting edit.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void act(retrySync)}>
              Retry sync
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setReloadOpen(true)}>
              Reload host workspace
            </Button>
          </div>
        </div>
      )}
      <div className="divide-y">
        {runtimes.map((entry) => (
          <div key={entry.profile.id} className="flex flex-wrap items-center gap-3 py-3">
            <Monitor size={17} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 break-words">{entry.profile.name}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px]',
                    entry.connected ? 'text-emerald-400' : 'text-muted-foreground',
                  )}
                >
                  <Circle size={6} fill="currentColor" />
                  {entry.connected ? 'Online' : 'Offline'}
                </span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {entry.profile.connection.address}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {!entry.snapshot?.owner && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setReplaceId(entry.profile.id)
                    setAddress('')
                    setCode('')
                    setError('')
                    setOpen(true)
                  }}
                >
                  Update address
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                aria-label={`Manage ${entry.profile.name}`}
                disabled={busy}
                onClick={() => onManage(entry.profile)}
              >
                Manage
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Reconnect ${entry.profile.name}`}
                disabled={busy}
                onClick={() => void act(() => refreshRuntime(entry.profile))}
              >
                Reconnect
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Remove this saved connection from this device"
                disabled={busy}
                onClick={() => void act(() => forgetRuntime(entry.profile.id))}
              >
                Forget
              </Button>
            </div>
          </div>
        ))}
      </div>
      {!runtimes.length && (
        <p className="text-xs leading-5 text-muted-foreground">
          Connect a computer with its address and a pairing code. Local network, Tailscale, and
          NetBird addresses are supported.
        </p>
      )}
      {error && !open && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog open={reloadOpen} onOpenChange={setReloadOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Discard unsent edits?</DialogTitle>
          <DialogDescription>
            This replaces this device’s unsent workspace edits with the current host version. A
            local backup is saved first. Files and running tasks on the host are unchanged.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setReloadOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await discardAndReload()
                  setReloadOpen(false)
                })
              }
            >
              Discard edits and reload
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) cancel()
          else setOpen(true)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>
            {replaceId ? 'Update connection address' : 'Connect a computer'}
          </DialogTitle>
          <DialogDescription>
            {replaceId &&
              'Pair the new address using a fresh code from the same computer. The saved connection stays unchanged until pairing succeeds. '}
            On the host, generate a pairing code in Devices & runtime or run the pair command. Use
            an address reachable from this device.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              const attempt = ++generation.current
              setBusy(true)
              setError('')
              void runtimeRequest(
                null,
                address,
                '/api/pair/request',
                {
                  protocolVersion: PAIRING_PROTOCOL_VERSION,
                  code,
                  name,
                },
                responses.pairRequest,
              )
                .then((result) => {
                  if (generation.current === attempt) setPending(result)
                })
                .catch((error) => {
                  if (generation.current === attempt)
                    setError(error instanceof Error ? error.message : String(error))
                })
                .finally(() => {
                  if (generation.current === attempt) setBusy(false)
                })
            }}
          >
            <FormField label="Runtime address">
              <Input
                aria-label="Runtime address"
                required
                type="url"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="http://my-desktop:51464"
                disabled={!!pending || busy}
              />
            </FormField>
            <p className="-mt-2 text-xs text-muted-foreground">
              Use the computer’s LAN or VPN address. 0.0.0.0 is a listening address, not a
              destination.
            </p>
            <FormField label="This device’s name">
              <Input
                aria-label="Pairing device name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!!pending || busy}
              />
            </FormField>
            <FormField label="Pairing code">
              <Input
                aria-label="Pairing code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{8}"
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                disabled={!!pending || busy}
              />
            </FormField>
            {pending && (
              <p role="status" className="text-xs text-muted-foreground">
                Connecting… If this code requires approval, approve this device on the host.
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button disabled={busy || !!pending}>
                {pending ? 'Connecting…' : 'Connect runtime'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  )
}
