import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  conversationPageSchema,
  mergeConversationHistory,
  type ConversationPage,
  type Task,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'

const emptyPages: ConversationPage[] = []
export function useConversationHistory<
  T extends Pick<Task, 'id' | 'messages' | 'turns' | 'historyBefore' | 'historyRevision'>,
>(live: T) {
  const { connection, request, connected } = useWorkspace()
  const revision = live.historyRevision ?? 0
  const scope = JSON.stringify([connection?.address, connection?.token, live.id])
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
  const previous = useRef({ scope, live })
  const latest = useRef(live)
  latest.current = live
  const refill = useRef(0)

  useEffect(() => {
    generation.current++
    pending.current = null
    setDelivery({ scope, busy: false, error: '' })
    return () => {
      generation.current++
    }
  }, [scope])

  useEffect(() => {
    active.current = scope
    const before = previous.current
    if (before.scope !== scope) refill.current = 0
    previous.current = { scope, live }
    const beforeIds = new Set(before.live.messages.map((message) => message.id))
    const gap =
      !!before.live.messages.length &&
      !!live.historyBefore &&
      !live.messages.some((message) => beforeIds.has(message.id))
    if (before.scope === scope && ((before.live.historyRevision ?? 0) !== revision || gap)) {
      refill.current = new Set(
        [
          ...(loaded.scope === scope ? loaded.pages.flatMap((page) => page.messages) : []),
          ...before.live.messages,
        ].map((message) => message.id),
      ).size
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
  const task = useMemo(() => mergeConversationHistory(live, pages), [live, pages])
  const cursor = !live.historyBefore
    ? undefined
    : pages.length
      ? pages[0]?.before
      : live.historyBefore
  const load = async () => {
    if (!cursor || !connected || pending.current?.scope === scope) return
    const operation = { scope, generation: generation.current }
    pending.current = operation
    setDelivery({ scope, busy: true, error: '' })
    try {
      const page = await request(
        '/api/tasks/history',
        { id: live.id, before: cursor },
        conversationPageSchema,
      )
      if (active.current !== scope || operation.generation !== generation.current) return
      if (page.before === cursor || (!page.messages.length && page.before))
        throw new Error('History did not advance. Reload the conversation before trying again.')
      if (
        (page.historyRevision ?? 0) !== revision &&
        (latest.current.historyRevision ?? 0) === revision
      )
        throw new Error('Conversation changed. Wait for the latest snapshot, then reload history.')
      if (
        active.current === scope &&
        (latest.current.historyRevision ?? 0) === revision &&
        (page.historyRevision ?? 0) === revision
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
      if (
        active.current === scope &&
        operation.generation === generation.current &&
        (latest.current.historyRevision ?? 0) === revision
      )
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
  }
  useEffect(() => {
    if (
      refill.current > task.messages.length &&
      cursor &&
      connected &&
      !delivery.busy &&
      !delivery.error
    )
      void load()
    // load closes over the current cursor/window; each successful page advances this effect.
  }, [task, cursor, connected, delivery, revision])
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
    error: delivery.scope === scope ? delivery.error : '',
  }
}
