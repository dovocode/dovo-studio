import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
  const [origin, setOrigin] = useState(''),
    [share, setShare] = useState<OpenShare | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false)
  const [hasKey, setHasKey] = useState(false),
    [hasShares, setHasShares] = useState(false)
  const [recovery, setRecovery] = useState(''),
    [preview, setPreview] = useState<SharedContent | null>(null)
  const [sync, setSync] = useState<{ enabled: boolean; error: string } | null>(null)
  const scope = JSON.stringify([client.origin, client.sessionId(), sourceId, kind])
  const current = useRef(scope),
    inFlight = useRef(false),
    options = useRef({ runtime, content })
  current.current = scope
  options.current = { runtime, content }
  const check = (captured: string) => {
    if (current.current !== captured) throw new Error('Sharing context changed. Reopen sharing.')
  }
  const load = useCallback(async () => {
    const captured = scope
    const destination = await client.sharingService()
    check(captured)
    setOrigin(destination)
    if (!client.snapshot().directory) {
      setLoaded(true)
      return
    }
    const key = await client.sharing.recoveryKey(),
      records = await client.sharing.list(destination)
    check(captured)
    setHasKey(!!key)
    setHasShares(records.length > 0)
    const existing = key
      ? records.find((record) => record.source === client.sharing.source(kind, sourceId, key))
      : undefined
    const opened = existing ? await client.sharing.refresh(destination, existing.id) : null
    check(captured)
    setShare(opened)
    if (opened?.record.kind === 'thread') {
      if (options.current.runtime) {
        const status = await options.current.runtime.status(opened.record.id)
        check(captured)
        setSync(status)
      }
    }
    setLoaded(true)
  }, [client, scope, kind, sourceId])
  useEffect(() => {
    setShare(null)
    setLoaded(false)
    setHasKey(false)
    setHasShares(false)
    setRecovery('')
    setPreview(null)
    setSync(null)
    setError('')
  }, [scope])
  const act = async (work: () => Promise<void>) => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true)
    setError('')
    const captured = scope
    try {
      await work()
      return true
    } catch (cause) {
      if (current.current === captured)
        setError(cause instanceof Error ? cause.message : 'Sharing failed')
      return false
    } finally {
      inFlight.current = false
      if (current.current === captured) setBusy(false)
    }
  }
  useEffect(() => {
    if (!active) return
    let stopped = false
    const refresh = () => {
      if (!stopped && !inFlight.current) void act(load)
    }
    refresh()
    const unsubscribe = client.sharing.subscribe(refresh)
    const timer = setInterval(refresh, 30000)
    return () => {
      stopped = true
      unsubscribe()
      clearInterval(timer)
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
      if ((await client.sharing.list(origin)).length)
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
    syncError: client.sharing.syncError,
    recovery,
    preview,
    sync,
    refresh: () => act(load),
    createKey: () =>
      act(async () => {
        if ((await client.sharing.list(origin)).length)
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
