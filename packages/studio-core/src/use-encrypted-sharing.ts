import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { Schema } from 'effect'
import {
  sharedContentSchema,
  mutableStruct,
  type AccountClient,
  type SharedContent,
  type OpenShare,
  type SharingWriterConfig,
} from '@dovo/protocol'

export type SharingRuntime = {
  preview: () => Promise<SharedContent>
  enable: (config: SharingWriterConfig) => Promise<unknown>
  stop: (id: string) => Promise<unknown>
  status: (id: string) => Promise<{ enabled: boolean; error: string }>
  taskId: string
}
export const sharingStatusSchema = mutableStruct({ enabled: Schema.Boolean, error: Schema.String })
export { sharedContentSchema }
export function useEncryptedSharing({
  client,
  sourceId,
  kind,
  content,
  runtime,
  active = true,
}: {
  client: AccountClient
  sourceId: string
  kind: 'artifact' | 'thread'
  content?: SharedContent
  runtime?: SharingRuntime
  active?: boolean
}) {
  useSyncExternalStore(client.sharing.subscribe, client.sharing.snapshot, client.sharing.snapshot)
  const [origin, writeOrigin] = useState(''),
    [share, writeShare] = useState<OpenShare | null>(null)
  const [busy, writeBusy] = useState(false),
    [error, writeError] = useState(''),
    [loaded, writeLoaded] = useState(false)
  const [hasKey, writeHasKey] = useState(false),
    [hasShares, writeHasShares] = useState(false)
  const [recovery, writeRecovery] = useState(''),
    [preview, writePreview] = useState<SharedContent | null>(null)
  const [sync, writeSync] = useState<{ enabled: boolean; error: string } | null>(null)
  const scope = JSON.stringify([client.origin, client.sessionId(), sourceId, kind])
  const context = useMemo(
    () => ({ mounted: false, recovered: false, pending: null as Promise<boolean> | null }),
    [client, scope],
  )
  const current = useRef(context),
    options = useRef({ runtime, content })
  current.current = context
  options.current = { runtime, content }
  const valid = () =>
    current.current === context &&
    context.mounted &&
    scope === JSON.stringify([client.origin, client.sessionId(), sourceId, kind])
  const check = (captured: string) => {
    if (!valid() || scope !== captured) throw new Error('Sharing context changed. Reopen sharing.')
  }
  const latest = useRef<{
    client: AccountClient
    scope: string
    key: string | null
    origin: string
    metadata: string
    share: OpenShare
  } | null>(null)
  // Every async action keeps the session/source it started with, including UI writes.
  const guarded =
    <T>(write: Dispatch<SetStateAction<T>>) =>
    (value: SetStateAction<T>) => {
      check(scope)
      write(value)
    }
  const setOrigin = guarded(writeOrigin)
  const setShare = (value: SetStateAction<OpenShare | null>) => {
    check(scope)
    latest.current = null
    writeShare(value)
  }
  const setBusy = guarded(writeBusy)
  const setError = guarded(writeError)
  const setLoaded = guarded(writeLoaded)
  const setHasKey = guarded(writeHasKey)
  const setHasShares = guarded(writeHasShares)
  const setRecovery = guarded(writeRecovery)
  const setPreview = guarded(writePreview)
  const setSync = guarded(writeSync)
  const load = useCallback(async () => {
    const captured = scope
    const target = options.current.runtime
    const destination = await client.sharingService()
    check(captured)
    setOrigin(destination)
    if (!client.snapshot().directory) {
      setShare(null)
      setHasKey(false)
      setHasShares(false)
      setSync(null)
      setLoaded(true)
      return
    }
    // The account owner handles periodic recovery. Opening settings still attempts
    // recovery once so standalone consumers and first-open recovery remain useful.
    if (!context.recovered) {
      context.recovered = true
      try {
        await client.sharing.syncKey()
      } catch (cause) {
        check(captured)
        setError(cause instanceof Error ? cause.message : 'Sharing recovery is unavailable')
      }
      check(captured)
    }
    const key = await client.sharing.recoveryKey()
    check(captured)
    const records = await client.sharing.list(destination)
    check(captured)
    setHasKey(!!key)
    setHasShares(records.length > 0)
    const existing = key
      ? records.find((record) => record.source === client.sharing.source(kind, sourceId, key))
      : undefined
    const previous = latest.current
    const unchanged =
      existing &&
      previous &&
      previous.key === key &&
      previous.origin === destination &&
      previous.scope === scope &&
      previous.client === client &&
      JSON.stringify(existing) === previous.metadata
    const opened = existing
      ? unchanged
        ? previous.share
        : await client.sharing.refresh(destination, existing.id)
      : null
    check(captured)
    latest.current =
      existing && opened
        ? {
            client,
            scope,
            key,
            origin: destination,
            metadata: JSON.stringify(existing),
            share: opened,
          }
        : null
    writeShare(opened)
    setSync(null)
    if (opened?.record.kind === 'thread') {
      if (target) {
        const status = await target.status(opened.record.id)
        check(captured)
        if (options.current.runtime === target) setSync(status)
      }
    }
    setLoaded(true)
  }, [client, scope, kind, sourceId, context])
  useEffect(() => {
    context.mounted = true
    latest.current = null
    setBusy(false)
    setShare(null)
    setLoaded(false)
    setHasKey(false)
    setHasShares(false)
    setRecovery('')
    setPreview(null)
    setSync(null)
    setError('')
    return () => {
      context.mounted = false
    }
  }, [context])
  // A disconnected or retargeted runtime must stop displaying the previous
  // runtime's status immediately, even while a load is still pending.
  useEffect(() => {
    writeSync(null)
  }, [runtime])
  const act = async (work: () => Promise<void>, periodic = false) => {
    if (periodic && context.pending) return context.pending
    while (context.pending) await context.pending
    if (!valid()) return false
    setBusy(true)
    setError('')
    if (!periodic) latest.current = null
    const operation = Promise.resolve().then(async () => {
      try {
        check(scope)
        await work()
        check(scope)
        return true
      } catch (cause) {
        if (valid()) setError(cause instanceof Error ? cause.message : 'Sharing failed')
        return false
      } finally {
        context.pending = null
        if (valid()) setBusy(false)
      }
    })
    context.pending = operation
    return operation
  }
  useEffect(() => {
    let stopped = false
    let queued = false
    let timer: ReturnType<typeof setInterval> | undefined
    const visible = () =>
      active && (typeof document === 'undefined' || document.visibilityState !== 'hidden')
    const refresh = () => {
      if (stopped || !visible()) return
      if (context.pending) {
        if (!queued) {
          queued = true
          void context.pending.then(() => {
            queued = false
            refresh()
          })
        }
        return
      }
      void act(load, true)
    }
    const visibility = () => {
      clearInterval(timer)
      timer = undefined
      if (!visible()) return
      refresh()
      timer = setInterval(refresh, 30000)
    }
    visibility()
    const unsubscribe = client.sharing.subscribe(refresh)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility)
    return () => {
      stopped = true
      unsubscribe()
      clearInterval(timer)
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', visibility)
    }
  }, [load, active])
  const resume = async (opened: OpenShare) => {
    const target = options.current.runtime
    if (!target) throw new Error('Reconnect to the source computer to enable updates')
    const result = await client.sharing.setPaused(origin, opened, false)
    setShare(result.share)
    if (!result.writer) throw new Error('Sharing writer permission is missing')
    try {
      const status = await target.enable({
        taskId: target.taskId,
        id: opened.record.id,
        origin,
        writerSecret: result.writer,
        contentKey: result.share.vault.contentKey,
        signingSeed: result.share.vault.signingSeed,
        generation: result.share.record.packet.generation,
      })
      setSync(
        status && typeof status === 'object' && 'enabled' in status
          ? { enabled: true, error: '' }
          : null,
      )
    } catch (cause) {
      check(scope)
      const paused = await client.sharing.setPaused(origin, result.share, true)
      setShare(paused.share)
      throw cause
    }
    return result.share
  }
  // Sharing is created on the first explicit invitation or link action. Reopening
  // the sheet reuses its publication and links, without another setup flow.
  const ensureShare = async () => {
    if (!loaded) throw new Error('Sharing settings are still loading')
    if (share) return share
    const captured = scope
    if (!hasKey) {
      const records = await client.sharing.list(origin)
      check(captured)
      if (records.length)
        throw new Error('Restore your recovery key to access your existing shared content')
      await client.sharing.recoveryKey(true)
      check(captured)
      setHasKey(true)
    }
    const value = options.current.content ?? (await options.current.runtime?.preview())
    check(captured)
    if (!value) throw new Error('Reconnect to the source computer to share this thread')
    const next = await client.sharing.publish(origin, sourceId, value)
    check(captured)
    setShare(next)
    setHasShares(true)
    return kind === 'thread' ? resume(next) : next
  }
  return {
    origin,
    share,
    setShare,
    busy,
    error,
    loaded,
    hasKey,
    hasShares,
    recoveryState: client.sharing.recoveryState,
    syncError: client.sharing.syncError,
    recovery,
    preview,
    sync,
    refresh: () =>
      act(async () => {
        await client.sharing.syncKey()
        check(scope)
        context.recovered = true
        await load()
      }),
    createKey: () =>
      act(async () => {
        const records = await client.sharing.list(origin)
        check(scope)
        if (records.length)
          throw new Error('Restore your existing recovery key to access published content')
        const key = await client.sharing.recoveryKey(true)
        if (key) setRecovery(key)
        setHasKey(true)
      }),
    showRecovery: () =>
      act(async () => {
        setRecovery(await client.sharing.key())
      }),
    hideRecovery: () => setRecovery(''),
    restore: (key: string) =>
      act(async () => {
        await client.sharing.restoreKey(key, origin)
        check(scope)
        await client.sharing.syncKey()
        check(scope)
        context.recovered = true
        await load()
      }),
    resetLegacySharing: () =>
      act(async () => {
        await client.sharing.resetLegacySharing(origin)
        setShare(null)
        setRecovery('')
        await load()
      }),
    review: () =>
      act(async () => {
        const value = options.current.content ?? (await options.current.runtime?.preview())
        if (!value) throw new Error('Reconnect to review the conversation before sharing')
        setPreview(value)
      }),
    publish: () =>
      act(async () => {
        if (!preview) throw new Error('Review the content before publishing')
        const next = await client.sharing.publish(origin, sourceId, preview)
        setShare(next)
        setPreview(null)
        setHasShares(true)
        if (kind === 'thread') await resume(next)
      }),
    invite: (recipient: string) =>
      act(async () => {
        const next = await ensureShare()
        setShare(await client.sharing.invite(origin, next, recipient))
      }),
    inviteOrganization: (organizationId: string) =>
      act(async () => {
        const next = await ensureShare()
        setShare(await client.sharing.invite(origin, next, undefined, undefined, organizationId))
      }),
    createLink: (seconds: number) =>
      act(async () => {
        const next = await ensureShare()
        setShare(await client.sharing.invite(origin, next, undefined, seconds))
      }),
    setLinkAccess: (enabled: boolean, seconds = 604800) =>
      act(async () => {
        if (enabled) {
          const next = await ensureShare()
          if (
            next.record.grants.some(
              (grant) =>
                !grant.userId && !grant.organizationId && (grant.expiresAt ?? 0) > Date.now(),
            )
          )
            return
          setShare(await client.sharing.invite(origin, next, undefined, seconds))
          return
        }
        if (!share) return
        let next = share
        for (const grant of share.record.grants.filter(
          (grant) => !grant.userId && !grant.organizationId,
        )) {
          next = await client.sharing.revoke(origin, next, grant.id)
          setShare(next)
        }
        if (kind === 'thread' && !share.record.paused && options.current.runtime) await resume(next)
      }),
    link: (id: string) => (share ? client.sharing.link(origin, share, id) : ''),
    revoke: (id: string) =>
      act(async () => {
        if (!share) return
        const next = await client.sharing.revoke(origin, share, id)
        setShare(next)
        if (kind === 'thread' && !share.record.paused && options.current.runtime) await resume(next)
      }),
    pause: () =>
      act(async () => {
        if (!share) return
        const result = await client.sharing.setPaused(origin, share, true)
        setShare(result.share)
        if (options.current.runtime) await options.current.runtime.stop(share.record.id)
        setSync({ enabled: false, error: '' })
      }),
    resume: () =>
      act(async () => {
        if (share) await resume(share)
      }),
    remove: () =>
      act(async () => {
        if (!share) return
        await client.sharing.remove(origin, share.record.id)
        setShare(null)
        if (options.current.runtime) await options.current.runtime.stop(share.record.id)
      }),
  }
}
