import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [origin, setOrigin] = useState(''),
    [share, setShare] = useState<OpenShare | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false)
  const [hasKey, setHasKey] = useState(false),
    [hasShares, setHasShares] = useState(false)
  const [recovery, setRecovery] = useState(''),
    [preview, setPreview] = useState<SharedContent | null>(null)
  const [suggestions, setSuggestions] = useState<
    Awaited<ReturnType<typeof client.sharing.suggestions>>
  >([])
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
      const inbox = await client.sharing.suggestions(destination, opened)
      check(captured)
      setSuggestions(inbox)
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
    setSuggestions([])
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
    const timer = setInterval(refresh, 30000)
    return () => {
      stopped = true
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
    recovery,
    preview,
    suggestions,
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
        if (share) setShare(await client.sharing.invite(origin, share, recipient))
      }),
    createLink: (seconds: number) =>
      act(async () => {
        if (share) setShare(await client.sharing.invite(origin, share, undefined, seconds))
      }),
    link: (id: string) => (share ? client.sharing.link(origin, share, id) : ''),
    revoke: (id: string) =>
      act(async () => {
        if (!share) return
        const next = await client.sharing.revoke(origin, share, id)
        setShare(next)
        if (kind === 'thread' && !share.record.paused) await resume(next)
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
        setSuggestions([])
        if (options.current.runtime) await options.current.runtime.stop(share.record.id)
      }),
    dismiss: (id: string) =>
      act(async () => {
        if (!share) return
        await client.sharing.dismiss(origin, share.record.id, id)
        setSuggestions((items) => items.filter((item) => item.id !== id))
      }),
  }
}
