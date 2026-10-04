import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import {
  conversationPageSchema,
  mergeConversationHistory,
  type ConversationPage,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'

const emptyPages: ConversationPage[] = []
const recentMessageCount = 500
export function useConversationHistory<
  T extends Pick<Task, 'id' | 'messages' | 'turns' | 'historyBefore' | 'historyRevision'>,
>(live: T) {
  const { profile, read: request, connected, readCache } = useRuntime()
  const revision = live.historyRevision ?? 0
  const scope = JSON.stringify([profile?.connection.address, profile?.connection.token, live.id])
  const [loaded, setLoaded] = useState<{
    scope: string
    revision: number
    pages: ConversationPage[]
  }>({
    scope,
    revision,
    pages: [],
  })
  const [delivery, setDelivery] = useState<{ scope: string; busy: boolean; error: string }>({
    scope,
    busy: false,
    error: '',
  })
  const active = useRef(scope)
  const generation = useRef(0)
  const pending = useRef<{ scope: string; generation: number } | null>(null)
  const [hydrated, setHydrated] = useState<string | null>(null)
  const [cacheError, setCacheError] = useState({ scope, error: '' })
  const previous = useRef({ scope, live })
  const latest = useRef(live)
  latest.current = live
  const refill = useRef(recentMessageCount)

  useEffect(() => {
    generation.current++
    setDelivery({ scope, busy: false, error: '' })
    setHydrated(null)
    setCacheError({ scope, error: '' })
    return () => {
      generation.current++
    }
  }, [scope])
  useEffect(() => {
    active.current = scope
    const before = previous.current
    if (before.scope !== scope) refill.current = recentMessageCount
    previous.current = { scope, live }
    const beforeIds = new Set(before.live.messages.map((message) => message.id))
    const gap =
      !!before.live.messages.length &&
      !!live.historyBefore &&
      !live.messages.some((message) => beforeIds.has(message.id))
    if (before.scope === scope && ((before.live.historyRevision ?? 0) !== revision || gap)) {
      refill.current = Math.max(
        recentMessageCount,
        new Set(
          [...loaded.pages.flatMap((page) => page.messages), ...before.live.messages].map(
            (message) => message.id,
          ),
        ).size,
      )
      generation.current++
      pending.current = null
      setLoaded({ scope, revision, pages: [] })
      setDelivery({ scope, busy: false, error: '' })
      return
    }
    // Only retain a live window when it rolls out of a conversation the reader expanded.
    if (before.scope === scope && before.live.messages[0]?.id !== live.messages[0]?.id)
      setLoaded((value) =>
        value.scope === scope && (value.pages.length || pending.current?.scope === scope)
          ? {
              scope,
              revision,
              pages: [
                ...value.pages,
                {
                  messages: before.live.messages,
                  turns: before.live.turns ?? [],
                  historyRevision: revision,
                  before: before.live.historyBefore,
                },
              ],
            }
          : value,
      )
  }, [scope, live])
  const pages = loaded.scope === scope && loaded.revision === revision ? loaded.pages : emptyPages
  const authoritative = connected || live.messages.length > 0
  const task = useMemo(
    () => mergeConversationHistory(live, pages, authoritative),
    [live, pages, authoritative],
  )
  const cursor =
    authoritative && !live.historyBefore
      ? undefined
      : pages.length
        ? pages[0]?.before
        : live.historyBefore
  useEffect(() => {
    let stopped = false
    setHydrated(null)
    const restore = async () => {
      let restored = false
      try {
        const cached = await readCache?.read(`conversation:${live.id}`, conversationPageSchema)
        restored = true
        if (!stopped && cached && (latest.current.historyRevision ?? 0) === revision) {
          const current = latest.current
          if (
            connected
              ? (cached.value.historyRevision ?? 0) !== revision
              : (cached.value.historyRevision ?? 0) < revision
          ) {
            setLoaded({ scope, revision, pages: [] })
            return
          }
          // Refill from the host if its current window no longer overlaps the
          // saved window, rather than presenting a gap as complete history.
          if (connected) {
            const boundary = current.historyBefore
              ? cached.value.messages.findIndex((message) => message.id === current.historyBefore)
              : -1
            // The live window is authoritative, including rewinds and removals.
            // Keep only cached messages strictly older than its first message.
            const messages = boundary < 0 ? [] : cached.value.messages.slice(0, boundary)
            const ids = new Set(messages.map((message) => message.id))
            setLoaded((value) =>
              value.scope === scope &&
              value.revision === revision &&
              value.pages.some((page) =>
                page.messages.some((message) => message.id === current.messages[0]?.id),
              )
                ? value
                : {
                    scope,
                    revision,
                    pages: messages.length
                      ? [
                          {
                            messages,
                            historyRevision: revision,
                            turns: cached.value.turns.filter((turn) => ids.has(turn.assistantId)),
                            before: cached.value.before,
                          },
                        ]
                      : [],
                  },
            )
          } else
            setLoaded((value) =>
              value.scope === scope && value.pages.length
                ? value
                : { scope, revision, pages: [cached.value] },
            )
        }
      } catch (cause) {
        if (!stopped)
          setCacheError({ scope, error: `Could not restore conversation: ${String(cause)}` })
      } finally {
        if (!stopped && restored) setHydrated(scope)
      }
    }
    void restore()
    return () => {
      stopped = true
    }
  }, [scope, readCache, live.id, connected, revision])
  const currentHistory = useRef(new Map([[scope, { task, cursor, hydrated }]]))
  useEffect(() => {
    currentHistory.current.set(scope, { task, cursor, hydrated })
  }, [scope, task, cursor, hydrated, readCache])
  useEffect(() => {
    if (!readCache) return
    let savedMessages: typeof task.messages | undefined
    let savedTurns: typeof task.turns | undefined
    let savedRevision: number | undefined
    const persist = async () => {
      const current = currentHistory.current.get(scope)
      if (!current || current.hydrated !== scope) return
      if (
        savedMessages === current.task.messages &&
        savedTurns === current.task.turns &&
        savedRevision === current.task.historyRevision
      )
        return
      // Persist a bounded recent window without rewriting large JSON on each token.
      const messages = current.task.messages.slice(-recentMessageCount)
      const ids = new Set(messages.map((message) => message.id))
      const page: ConversationPage = {
        messages,
        historyRevision: current.task.historyRevision,
        turns: current.task.turns?.filter((turn) => ids.has(turn.assistantId)) ?? [],
        before: current.task.messages.length > messages.length ? messages[0]?.id : current.cursor,
      }
      try {
        await readCache.write(`conversation:${live.id}`, page)
        savedMessages = current.task.messages
        savedTurns = current.task.turns
        savedRevision = current.task.historyRevision
        if (active.current === scope) setCacheError({ scope, error: '' })
      } catch (cause) {
        if (active.current === scope)
          setCacheError({ scope, error: `Could not save conversation: ${String(cause)}` })
      }
    }
    let timer: ReturnType<typeof setInterval> | undefined
    const schedule = () => {
      clearInterval(timer)
      timer =
        AppState.currentState === 'active' ? setInterval(() => void persist(), 30_000) : undefined
    }
    schedule()
    const subscription = AppState.addEventListener('change', (state) => {
      schedule()
      if (state !== 'active') void persist()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
      void persist()
      currentHistory.current.delete(scope)
    }
  }, [scope, readCache, live.id])
  const load = useCallback(async () => {
    if (
      !cursor ||
      !connected ||
      (pending.current?.scope === scope && pending.current.generation === generation.current)
    )
      return
    const operation = { scope, generation: generation.current }
    pending.current = operation
    setDelivery({ scope, busy: true, error: '' })
    try {
      const page = await request(
        '/api/tasks/history',
        { id: live.id, before: cursor },
        conversationPageSchema,
      )
      if (
        (page.historyRevision ?? 0) !== (latest.current.historyRevision ?? 0) &&
        operation.generation === generation.current
      )
        throw new Error('Conversation changed. Wait for the latest snapshot, then reload history.')
      if (page.before === cursor || (!page.messages.length && page.before))
        throw new Error('History did not advance. Reload the conversation before trying again.')
      if (
        active.current === scope &&
        operation.generation === generation.current &&
        (page.historyRevision ?? 0) === (latest.current.historyRevision ?? 0)
      )
        setLoaded((value) => ({
          scope,
          revision,
          pages: [
            page,
            ...(value.scope === scope ? value.pages : []),
            { messages: live.messages, turns: live.turns ?? [], historyRevision: revision },
          ],
        }))
    } catch (cause) {
      if (active.current === scope && operation.generation === generation.current)
        setDelivery({
          scope,
          busy: false,
          error: cause instanceof Error ? cause.message : String(cause),
        })
    } finally {
      if (pending.current === operation) pending.current = null
      if (operation.generation === generation.current)
        setDelivery((value) => (value.scope === scope ? { ...value, busy: false } : value))
    }
  }, [cursor, connected, scope, request, live, revision])
  useEffect(() => {
    // Keep transport pages small; fill the recent window incrementally.
    if (
      hydrated !== scope ||
      !cursor ||
      !connected ||
      task.messages.length >= refill.current ||
      (delivery.scope === scope && (delivery.busy || delivery.error))
    )
      return
    void load()
  }, [scope, cursor, connected, load, hydrated, task.messages.length, delivery])
  const setBookmark = useCallback(
    (messageId: string, bookmarked: boolean) =>
      setLoaded((value) =>
        value.scope === scope
          ? {
              ...value,
              pages: value.pages.map((page) => ({
                ...page,
                messages: page.messages.map((message) =>
                  message.id === messageId ? { ...message, bookmarked } : message,
                ),
              })),
            }
          : value,
      ),
    [scope],
  )
  return {
    setBookmark,
    task,
    load,
    hasMore: !!cursor,
    busy: delivery.scope === scope && delivery.busy,
    error:
      (delivery.scope === scope ? delivery.error : '') ||
      (cacheError.scope === scope ? cacheError.error : ''),
  }
}
