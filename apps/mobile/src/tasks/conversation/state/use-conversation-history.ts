import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  conversationPageSchema,
  mergeConversationHistory,
  type ConversationPage,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'

const emptyPages: ConversationPage[] = []
export function useConversationHistory<
  T extends Pick<Task, 'id' | 'messages' | 'turns' | 'historyBefore'>,
>(live: T) {
  const { profile, read: request, connected } = useRuntime()
  const scope = JSON.stringify([profile?.connection.address, profile?.connection.token, live.id])
  const [loaded, setLoaded] = useState<{ scope: string; pages: ConversationPage[] }>({
    scope,
    pages: [],
  })
  const [delivery, setDelivery] = useState<{ scope: string; busy: boolean; error: string }>({
    scope,
    busy: false,
    error: '',
  })
  const active = useRef(scope)
  const pending = useRef<string | null>(null)
  const previous = useRef({ scope, live })
  useEffect(() => {
    active.current = scope
    const before = previous.current
    previous.current = { scope, live }
    // Only retain a live window when it rolls out of a conversation the reader expanded.
    if (before.scope === scope && before.live.messages[0]?.id !== live.messages[0]?.id)
      setLoaded((value) =>
        value.scope === scope && (value.pages.length || pending.current === scope)
          ? {
              scope,
              pages: [
                ...value.pages,
                {
                  messages: before.live.messages,
                  turns: before.live.turns ?? [],
                  before: before.live.historyBefore,
                },
              ],
            }
          : value,
      )
  }, [scope, live])
  const pages = loaded.scope === scope ? loaded.pages : emptyPages
  const task = useMemo(() => mergeConversationHistory(live, pages), [live, pages])
  const cursor = pages.length ? pages[0]?.before : live.historyBefore
  const load = async () => {
    if (!cursor || !connected || pending.current === scope) return
    pending.current = scope
    setDelivery({ scope, busy: true, error: '' })
    try {
      const page = await request(
        '/api/tasks/history',
        { id: live.id, before: cursor },
        conversationPageSchema,
      )
      if (active.current === scope)
        setLoaded((value) => ({
          scope,
          pages: [
            page,
            ...(value.scope === scope ? value.pages : []),
            { messages: live.messages, turns: live.turns ?? [] },
          ],
        }))
    } catch (cause) {
      if (active.current === scope)
        setDelivery({
          scope,
          busy: false,
          error: cause instanceof Error ? cause.message : String(cause),
        })
    } finally {
      if (pending.current === scope) pending.current = null
      setDelivery((value) => (value.scope === scope ? { ...value, busy: false } : value))
    }
  }
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
