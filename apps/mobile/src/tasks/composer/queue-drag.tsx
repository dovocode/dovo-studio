import { useEffect, useMemo, useRef, useState, type ReactNode, type ComponentRef } from 'react'
import { ScrollView, View, type LayoutRectangle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

type Drop = { messageId: string; edge: 'before' | 'after' }
type Drag = { id: string; translation: number; drop: Drop | null }

/** Keep the queue authoritative until a drop is acknowledged by its computer. */
export function useQueueDrag({
  ids,
  enabled,
  move,
}: {
  ids: string[]
  enabled: boolean
  move: (id: string, beforeMessageId: string | null) => void
}) {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const scrollGesture = useMemo(() => Gesture.Native(), [])
  const rows = useRef(new Map<string, LayoutRectangle>())
  const viewport = useRef({ height: 0, contentHeight: 0, offset: 0 })
  const active = useRef<{
    id: string
    origin: number
    offset: number
    translation: number
    order: string
  } | null>(null)
  const frame = useRef<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef({ ids, enabled, move })
  latest.current = { ids, enabled, move }

  const position = () => {
    const current = active.current
    if (!current) return null
    const translation = current.translation + viewport.current.offset - current.offset
    const center = current.origin + translation
    const candidates = latest.current.ids.filter((id) => id !== current.id)
    let drop: Drop | null = null
    for (const id of candidates) {
      const row = rows.current.get(id)
      if (!row) continue
      drop = { messageId: id, edge: 'after' }
      if (center < row.y + row.height / 2) {
        drop.edge = 'before'
        break
      }
    }
    return { id: current.id, translation, drop }
  }
  const cancel = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    active.current = null
    setDrag(null)
  }
  const tick = () => {
    const current = active.current
    if (!current) return
    const view = viewport.current
    const fingerY = current.origin - current.offset + current.translation
    const step = fingerY < 32 ? -4 : fingerY > view.height - 32 ? 4 : 0
    const offset = Math.max(0, Math.min(view.contentHeight - view.height, view.offset + step))
    if (offset !== view.offset) {
      view.offset = offset
      scroll.current?.scrollTo({ y: offset, animated: false })
      setDrag(position())
    }
    frame.current = requestAnimationFrame(tick)
  }
  const begin = (id: string) => {
    const row = rows.current.get(id)
    if (!latest.current.enabled || !latest.current.ids.includes(id) || !row) return
    active.current = {
      id,
      order: JSON.stringify(latest.current.ids),
      origin: row.y + row.height / 2,
      offset: viewport.current.offset,
      translation: 0,
    }
    setDrag(position())
    frame.current = requestAnimationFrame(tick)
  }
  const update = (translation: number) => {
    if (!active.current) return
    active.current.translation = translation
    setDrag(position())
  }
  const end = () => {
    const unchanged = active.current?.order === JSON.stringify(latest.current.ids)
    const result = unchanged ? position() : null
    cancel()
    if (!result?.drop || !latest.current.enabled) return
    const { ids, move } = latest.current
    if (!ids.includes(result.id)) return
    const remaining = ids.filter((id) => id !== result.id)
    const target = remaining.indexOf(result.drop.messageId)
    if (target < 0) return
    const before =
      result.drop.edge === 'before' ? remaining[target] : (remaining[target + 1] ?? null)
    if (before !== (ids[ids.indexOf(result.id) + 1] ?? null)) move(result.id, before)
  }
  // A server update, disconnect or another action invalidates the gesture's original order.
  const identity = JSON.stringify(ids)
  useEffect(() => {
    cancel()
    const existing = new Set(latest.current.ids)
    for (const id of rows.current.keys()) if (!existing.has(id)) rows.current.delete(id)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      active.current = null
    }
  }, [identity, enabled])
  return { scroll, scrollGesture, rows, viewport, drag, begin, update, end, cancel }
}

export function QueueDragTarget({
  children,
  enabled,
  begin,
  update,
  end,
  cancel,
  handle = false,
  scrollGesture,
}: {
  children: ReactNode
  enabled: boolean
  handle?: boolean
  scrollGesture: ReturnType<typeof Gesture.Native>
  begin: () => void
  update: (translation: number) => void
  end: () => void
  cancel: () => void
}) {
  const latest = useRef({ begin, update, end, cancel })
  latest.current = { begin, update, end, cancel }
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(enabled)
      .minDistance(handle ? 1 : 10)
      // The queue must wait for the row pan to fail before it can scroll.
      .blocksExternalGesture(scrollGesture)
      .runOnJS(true)
      .onStart(() => latest.current.begin())
      .onUpdate((event) => latest.current.update(event.translationY))
      .onEnd(() => latest.current.end())
      .onFinalize((_event, success) => {
        if (!success) latest.current.cancel()
      })
    if (!handle) pan.activateAfterLongPress(300)
    return pan
  }, [enabled, handle, scrollGesture])
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        style={
          handle
            ? { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }
            : { flex: 1, minWidth: 0 }
        }
      >
        {children}
      </View>
    </GestureDetector>
  )
}
