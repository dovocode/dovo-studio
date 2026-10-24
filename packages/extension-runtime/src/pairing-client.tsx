import { LinuxSetupGuide } from './linux-setup-guide'
import {
  connectionProgress,
  runtimePeerAddress,
  runtimeTransportAddress,
  runtimeReachability,
  workspaceRecoveriesSchema,
  type WorkspaceRecovery,
  runtimeSyncStatus,
  retryRuntimeSync,
  PAIRING_PROTOCOL_VERSION,
  pairingAddress,
} from '@dovo/protocol'
import { ComputerUpdates } from './computer-updates'
import { Effect } from 'effect'
import { runtimeRequestEffect } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import type { RuntimeProfile } from '@dovo/studio-core'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import { Plus, Circle } from 'lucide-react'
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
export function PairingClient({
  onManage,
  discovered,
}: {
  onManage: (profile: RuntimeProfile) => void
  discovered?: { address: string }
}) {
  const {
    connect,
    cancelPairing,
    runtimeRegistry,
    runtimes,
    refreshRuntime,
    readRuntime,
    forgetRuntime,
    retrySync,
    discardAndReload,
    pendingSync,
    mutationStatus,
    discardMutations,
  } = useWorkspace()
  const [recoveryCursor, setRecoveryCursor] = useApplicationState<string | undefined>(undefined)
  const [recoveryOwner, setRecoveryOwner] = useApplicationState<RuntimeProfile | null>(null)
  const [recoveryWarnings, setRecoveryWarnings] = useApplicationState<string[]>([])
  const [recoveries, setRecoveries] = useApplicationState<WorkspaceRecovery[] | null>(null)
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
  useEffect(() => {
    if (discovered) {
      setAddress(discovered.address)
      setCode('')
      setReplaceId(undefined)
      setOpen(true)
    }
  }, [discovered])
  const [discardTarget, setDiscardTarget] = useApplicationState<RuntimeProfile | null>(null)
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
  const openNewConnection = () => {
    setError('')
    setReplaceId(undefined)
    setAddress('')
    setCode('')
    setOpen(true)
  }
  return (
    <article className="space-y-4 rounded-md border bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Your computers</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tasks and projects from these computers appear in your workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ComputerUpdates />
          <LinuxSetupGuide onConnect={openNewConnection} />
          <Button size="sm" variant="outline" onClick={openNewConnection}>
            <Plus size={14} className="mr-1.5" />
            Connect computer
          </Button>
        </div>
      </div>
      {!!runtimeRegistry.pendingPairings?.length && (
        <p role="status" className="text-xs text-muted-foreground">
          A connection is waiting to finish pairing. Keep the computer online; recovery retries when
          you return to this window.
        </p>
      )}
      {pendingSync && (
        <div className="space-y-3 rounded-lg border border-status-warning/30 bg-status-warning/5 p-3">
          <div>
            <h3 className="text-xs font-medium">Unsent changes</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Edits for{' '}
              {runtimeRegistry.profiles.find((entry) => entry.id === runtimeRegistry.activeId)
                ?.name ?? 'this computer'}{' '}
              stay on this device until they sync. Saved edits resume automatically after
              reconnecting. Conflicting edits resolve automatically and remain available in
              Recovered edits.
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
        {runtimes.map((entry) => {
          return (
            <div key={entry.profile.id} className="flex flex-wrap items-center gap-3 py-3">
              <RuntimeIcon
                icon={entry.snapshot?.runtimeIcon}
                aria-hidden="true"
                size={17}
                className="shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 break-words">{entry.profile.name}</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-[0.6875rem]',
                      entry.connected ? 'text-status-success' : 'text-muted-foreground',
                    )}
                  >
                    <Circle aria-hidden="true" size={6} fill="currentColor" />
                    {entry.connected
                      ? runtimeSyncStatus(entry.profile.connection) === 'live'
                        ? 'Live'
                        : runtimeSyncStatus(entry.profile.connection)
                          ? 'Online · HTTP updates'
                          : 'Online'
                      : entry.unauthorized
                        ? 'Pairing expired'
                        : runtimeReachability(entry) === 'connecting'
                          ? 'Connecting…'
                          : 'Offline'}
                  </span>
                </p>
                <ol
                  aria-label="Connection stages"
                  className="my-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                >
                  {connectionProgress(entry).map((step) => (
                    <li
                      key={step.label}
                      aria-current={
                        step.state === 'current' || step.state === 'failed' ? 'step' : undefined
                      }
                      className={cn(
                        'flex items-center gap-1',
                        step.state === 'failed'
                          ? 'text-status-error'
                          : step.state === 'current'
                            ? 'text-foreground'
                            : 'text-muted-foreground',
                      )}
                    >
                      <span aria-hidden="true">
                        {step.state === 'done'
                          ? '✓'
                          : step.state === 'failed'
                            ? '×'
                            : step.state === 'current'
                              ? '◉'
                              : '○'}
                      </span>
                      {step.label}
                      <span className="sr-only"> · {step.state}</span>
                    </li>
                  ))}
                </ol>
                {entry.connected && (
                  <p className="text-xs text-muted-foreground">
                    {runtimePeerAddress(entry.profile.connection)
                      ? 'Internet · WebRTC'
                      : 'Direct · HTTP / HTTPS'}{' '}
                    ·{' '}
                    {runtimePeerAddress(entry.profile.connection)
                      ? 'Encrypted peer connection'
                      : runtimeTransportAddress(entry.profile.connection)}
                  </p>
                )}
                <p className="truncate text-xs text-muted-foreground">
                  {entry.profile.connection.address}
                </p>
                {!entry.connected && entry.lastSeen && (
                  <p className="text-xs text-muted-foreground">
                    Last connected {new Date(entry.lastSeen).toLocaleString()}
                  </p>
                )}
                {!entry.connected && entry.error && (
                  <p className="break-words text-xs text-destructive">{entry.error}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {mutationStatus(entry.profile).pending > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError('')
                      setDiscardTarget(entry.profile)
                    }}
                  >
                    Discard saved actions ({mutationStatus(entry.profile).pending})
                  </Button>
                )}
                {!entry.snapshot?.owner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Update address for ${entry.profile.name}`}
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
                {entry.connected && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !entry.connected}
                    onClick={() =>
                      void act(async () => {
                        const value = await readRuntime(
                          entry.profile,
                          '/api/workspace/recovered-edits',
                          undefined,
                          workspaceRecoveriesSchema,
                          'GET',
                        )
                        setRecoveries(value.edits)
                        setRecoveryCursor(value.nextCursor)
                        setRecoveryOwner(entry.profile)
                        setRecoveryWarnings(value.warnings ?? [])
                      })
                    }
                  >
                    Recovered edits
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
                  onClick={() =>
                    void act(() => {
                      retryRuntimeSync(entry.profile.connection)
                      return refreshRuntime(entry.profile)
                    })
                  }
                >
                  Reconnect
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Forget ${entry.profile.name}`}
                  title="Remove this saved connection from this device"
                  disabled={busy}
                  onClick={() => void act(() => forgetRuntime(entry.profile.id))}
                >
                  Forget
                </Button>
              </div>
            </div>
          )
        })}
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
        open={!!discardTarget}
        onOpenChange={(value) => {
          if (!value && !busy) setDiscardTarget(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>Discard saved actions?</DialogTitle>
          <DialogDescription>
            This removes saved commands for {discardTarget?.name} from this device, including unsent
            messages. Actions already applied on the computer remain applied. Workspace edits remain
            saved. The computer can be offline.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setDiscardTarget(null)}>
              Keep actions
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  if (!discardTarget) return
                  await discardMutations(discardTarget)
                  setDiscardTarget(null)
                })
              }
            >
              Discard saved actions
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
              void Promise.resolve()
                .then(() => {
                  const target = pairingAddress(address)
                  setAddress(target)
                  return runtimeRequest(
                    null,
                    target,
                    '/api/pair/request',
                    {
                      protocolVersion: PAIRING_PROTOCOL_VERSION,
                      code,
                      name,
                    },
                    responses.pairRequest,
                  )
                })
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
                inputMode="url"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="http://my-desktop:51464"
                disabled={!!pending || busy}
                spellCheck={false}
                autoCapitalize="off"
              />
            </FormField>
            <p className="-mt-2 text-xs text-muted-foreground">
              Use the computer’s LAN or VPN address. 0.0.0.0 is a listening address, not a
              destination. HTTP and optional HTTPS are supported.
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
      <Dialog
        open={recoveries !== null}
        onOpenChange={(open) => {
          if (!open) setRecoveries(null)
        }}
      >
        <DialogContent>
          <DialogTitle>Recovered edits</DialogTitle>
          <DialogDescription>
            Conflicting edits are saved here while the runtime value stays in use. Select and copy
            an edit to recover it.
          </DialogDescription>
          {recoveryWarnings.map((warning) => (
            <p key={warning} role="status">
              {warning}
            </p>
          ))}
          <div className="max-h-96 overflow-auto space-y-3">
            {recoveries?.length === 0 && <p>No recovered edits.</p>}
            {recoveries?.map((edit) => (
              <details key={edit.id}>
                <summary>
                  {edit.createdAt} · {edit.patch.collection}/{edit.patch.id}
                </summary>
                <pre className="whitespace-pre-wrap break-all text-xs select-text">
                  {JSON.stringify(edit, null, 2)}
                </pre>
              </details>
            ))}
          </div>
          {recoveryCursor && recoveryOwner && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const value = await readRuntime(
                    recoveryOwner,
                    '/api/workspace/recovered-edits?cursor=' + encodeURIComponent(recoveryCursor),
                    undefined,
                    workspaceRecoveriesSchema,
                    'GET',
                  )
                  setRecoveries((previous) => [
                    ...new Map(
                      [...(previous ?? []), ...value.edits].map((edit) => [edit.id, edit]),
                    ).values(),
                  ])
                  setRecoveryCursor(value.nextCursor)
                })
              }
            >
              Load older edits
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </article>
  )
}
