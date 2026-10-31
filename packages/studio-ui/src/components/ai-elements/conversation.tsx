import { reducedMotion } from '@dovo/studio-core'
import { createReadingPositionCache, readingPositionOffset } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
// Adapted from Vercel AI Elements (MIT), packages/elements/src/conversation.tsx.
import {
  ConversationContent as SharedConversationContent,
  ConversationScrollButton as SharedConversationScrollButton,
} from '@dovo/web-ui/conversation'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from 'react'
import { cn } from '../../lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
export { Conversation } from '@dovo/web-ui/conversation'

export function ConversationContent({
  className,
  style,
  ...props
}: ComponentProps<typeof StickToBottom.Content>) {
  const ready = useContext(HistoryReady)
  const positioned = useContext(HistoryPositioned)
  return (
    <SharedConversationContent
      {...props}
      className={className}
      // Keep scroll measurements available while the initial position settles.
      style={ready && positioned ? style : { ...style, visibility: 'hidden' }}
    />
  )
}
const HistoryReady = createContext(true)
const HistoryPositioned = createContext(true)
const readingPositions = createReadingPositionCache()
/** Mount the latest content before allowing old turns to enter the render window. */
export function ConversationHistory({
  children,
  onLoadEarlier,
  onReadingHistory,
  onReady,
  active = true,
  settled = false,
  positionKey,
  navigationKey,
  hasEarlier = false,
  loadingEarlier = false,
  onRestoreAnchor,
}: {
  children: ReactNode
  onLoadEarlier?: () => void
  onReadingHistory?: () => void
  onReady?: () => void
  active?: boolean
  settled?: boolean
  positionKey?: string
  navigationKey?: string
  hasEarlier?: boolean
  loadingEarlier?: boolean
  onRestoreAnchor?: (id: string | undefined) => void
}) {
  const { scrollToBottom, scrollRef, escapedFromLock, stopScroll } = useStickToBottomContext()
  const [ready, setReady] = useState(false)
  const [positioned, setPositioned] = useState(false)
  const restoring = useRef(false)
  const cancelRestoration = useRef<(() => void) | undefined>(undefined)
  const callbacks = useRef({
    onLoadEarlier,
    onRestoreAnchor,
    hasEarlier,
    loadingEarlier,
    navigationKey,
  })
  callbacks.current = { onLoadEarlier, onRestoreAnchor, hasEarlier, loadingEarlier, navigationKey }
  const previous = useRef({ active, settled })
  useEffect(() => {
    const before = previous.current
    previous.current = { active, settled }
    // Reopening an already mounted thread restores following just like a fresh visit.
    if (!positionKey && active && (!before.active || (before.settled && !settled)))
      void scrollToBottom({ animation: 'instant' })
  }, [active, settled, scrollToBottom, positionKey])
  useEffect(() => {
    let disposed = false
    if (callbacks.current.navigationKey) {
      setReady(true)
      onReady?.()
      return
    }
    void Promise.resolve(scrollToBottom({ animation: 'instant' })).then(() => {
      if (!disposed) {
        setReady(true)
        onReady?.()
      }
    })
    return () => {
      disposed = true
    }
  }, [scrollToBottom, onReady])
  useLayoutEffect(() => {
    if (!ready || !active) return
    const root = scrollRef.current
    if (!root) return
    const saved = positionKey ? readingPositions.read(positionKey) : undefined
    let cancelled = false
    let frame: number | undefined
    let captureFrame: number | undefined
    let attempts = 0
    let stable = 0
    const navigation = callbacks.current.navigationKey
    const finish = () => {
      if (cancelled) return
      cancelled = true
      restoring.current = false
      if (frame !== undefined) cancelAnimationFrame(frame)
      callbacks.current.onRestoreAnchor?.(undefined)
      setPositioned(true)
    }
    cancelRestoration.current = finish
    restoring.current = !!saved && !saved.atEnd && !navigation
    setPositioned(!restoring.current)
    const capture = () => {
      if (!positionKey || restoring.current || !root.getClientRects().length) return
      const top = root.getBoundingClientRect().top
      const anchors = root.querySelectorAll<HTMLElement>('[data-conversation-anchor]')
      let start = 0
      let end = anchors.length
      while (start < end) {
        const middle = (start + end) >>> 1
        if (anchors[middle].getBoundingClientRect().bottom <= top) start = middle + 1
        else end = middle
      }
      const anchor = anchors[start]
      readingPositions.remember(positionKey, {
        anchorId: anchor?.id,
        anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : 0,
        scrollOffset: root.scrollTop,
        atEnd: root.scrollHeight - root.clientHeight - root.scrollTop <= 80,
      })
    }
    const captureLater = () => {
      if (captureFrame !== undefined) return
      captureFrame = requestAnimationFrame(() => {
        captureFrame = undefined
        capture()
      })
    }
    const restore = () => {
      frame = undefined
      if (cancelled || !saved || !restoring.current) return
      if (callbacks.current.navigationKey !== navigation) {
        finish()
        return
      }
      const anchor = saved.anchorId ? document.getElementById(saved.anchorId) : null
      if (!anchor || !root.contains(anchor)) {
        if (callbacks.current.hasEarlier) {
          if (!callbacks.current.loadingEarlier) callbacks.current.onLoadEarlier?.()
          return
        }
        root.scrollTop = saved.scrollOffset
        finish()
        return
      }
      const measured = anchor.getBoundingClientRect().top - root.getBoundingClientRect().top
      const desired = readingPositionOffset(root.scrollTop, measured, saved.anchorOffset)
      attempts++
      if (Math.abs(desired - root.scrollTop) > 1) {
        stable = 0
        root.scrollTop = desired
      } else stable++
      if (stable >= 3 || attempts >= 60) {
        finish()
        return
      }
      frame = requestAnimationFrame(restore)
    }
    const schedule = () => {
      if (restoring.current && !cancelled && frame === undefined)
        frame = requestAnimationFrame(restore)
    }
    const navigate = () => {
      if (restoring.current) finish()
    }
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    const interactionRoot = root.parentElement ?? root
    for (const event of events) interactionRoot.addEventListener(event, navigate, { passive: true })
    root.addEventListener('scroll', captureLater, { passive: true })
    const observer = new MutationObserver(schedule)
    observer.observe(root, { childList: true, subtree: true })
    if (restoring.current) {
      stopScroll()
      callbacks.current.onRestoreAnchor?.(saved?.anchorId)
      schedule()
    } else if (navigation) stopScroll()
    else if (saved?.atEnd) void scrollToBottom({ animation: 'instant' })
    return () => {
      capture()
      cancelled = true
      restoring.current = false
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (captureFrame !== undefined) cancelAnimationFrame(captureFrame)
      observer.disconnect()
      if (cancelRestoration.current === finish) cancelRestoration.current = undefined
      for (const event of events) interactionRoot.removeEventListener(event, navigate)
      root.removeEventListener('scroll', captureLater)
    }
  }, [ready, active, positionKey, scrollRef, stopScroll, scrollToBottom])
  useLayoutEffect(() => {
    if (navigationKey) cancelRestoration.current?.()
  }, [navigationKey])
  useEffect(() => {
    const root = scrollRef.current
    if (!escapedFromLock || !onReadingHistory || !root) return
    const reading = () => {
      if (root.scrollHeight - root.clientHeight - root.scrollTop > 120) onReadingHistory()
    }
    root.addEventListener('scroll', reading, { passive: true })
    reading()
    return () => root.removeEventListener('scroll', reading)
  }, [escapedFromLock, onReadingHistory, scrollRef])
  useEffect(() => {
    const root = scrollRef.current
    if (!ready || !onLoadEarlier || !root) return
    const loadNearStart = () => {
      if (root.scrollTop <= 800) onLoadEarlier()
    }
    root.addEventListener('scroll', loadNearStart, { passive: true })
    loadNearStart()
    return () => root.removeEventListener('scroll', loadNearStart)
  }, [ready, onLoadEarlier, scrollRef])
  return (
    <HistoryReady.Provider value={ready}>
      <HistoryPositioned.Provider value={positioned}>{children}</HistoryPositioned.Provider>
    </HistoryReady.Provider>
  )
}
export function useConversationHistory() {
  const ready = useContext(HistoryReady)
  const { scrollRef } = useStickToBottomContext()
  return { ready, scrollRef }
}

export function ConversationScrollButton() {
  return <SharedConversationScrollButton reduceMotion={reducedMotion()} />
}

// Kept inside the conversation context so jumping also suspends automatic following.
export function ConversationRail({
  items,
}: {
  items: Array<{
    id: string
    label: string
    preview?: string
    status?: 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled'
  }>
}) {
  const { scrollRef, stopScroll } = useStickToBottomContext()
  const [hovered, setHovered] = useApplicationState<string | null>(null)
  const hoverIndex = items.findIndex((item) => item.id === hovered)
  const [visible, setVisible] = useApplicationState<Set<string>>(new Set())
  const observedIds = JSON.stringify(items.map((item) => item.id))
  useEffect(() => {
    const ids: string[] = JSON.parse(observedIds)
    const root = scrollRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((previous) => {
          const next = new Set(previous)
          for (const entry of entries) {
            if (entry.isIntersecting) next.add(entry.target.id)
            else next.delete(entry.target.id)
          }
          return next.size === previous.size && [...next].every((id) => previous.has(id))
            ? previous
            : next
        })
      },
      {
        root,
        threshold: 0,
      },
    )
    for (const id of ids) {
      const element = document.getElementById(id)
      if (element && root.contains(element)) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [observedIds, scrollRef])
  // A single turn has nowhere to jump; its lone marker reads as a rendering glitch.
  if (items.length < 2) return null
  return (
    <TooltipProvider delayDuration={100} skipDelayDuration={500}>
      <nav
        aria-label="Conversation turns"
        onPointerLeave={() => setHovered(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setHovered(null)
        }}
        className="absolute bottom-6 left-0 top-6 hidden w-12 flex-col items-start justify-center overflow-visible py-1 md:flex"
      >
        {items.map((item, index) => (
          <Tooltip key={item.id} open={hovered === item.id} disableHoverableContent>
            <TooltipTrigger asChild>
              <button
                type="button"
                onPointerEnter={() => setHovered(item.id)}
                onPointerLeave={() =>
                  setHovered((current) => (current === item.id ? null : current))
                }
                onFocus={() => setHovered(item.id)}
                onBlur={() => setHovered((current) => (current === item.id ? null : current))}
                aria-label={`Jump to turn ${index + 1}: ${item.label}`}
                aria-current={visible.has(item.id) ? 'location' : undefined}
                className="group flex min-h-0 max-h-2 w-12 flex-1 items-center justify-start pl-3 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => {
                  setHovered(null)
                  const root = scrollRef.current
                  const target = document.getElementById(item.id)
                  if (!root || !target || !root.contains(target)) return
                  stopScroll()
                  root.scrollTo({
                    top:
                      root.scrollTop +
                      target.getBoundingClientRect().top -
                      root.getBoundingClientRect().top -
                      16,
                    behavior: reducedMotion() ? 'instant' : 'smooth',
                  })
                }}
              >
                <span
                  style={{
                    width:
                      hoverIndex < 0
                        ? 8
                        : Math.abs(index - hoverIndex) === 0
                          ? 24
                          : Math.abs(index - hoverIndex) === 1
                            ? 16
                            : Math.abs(index - hoverIndex) === 2
                              ? 12
                              : 8,
                  }}
                  className={cn(
                    'h-[2px] rounded-full transition-[width,background-color] duration-150 ease-out group-hover:bg-foreground group-focus-visible:bg-foreground motion-reduce:transition-none',
                    visible.has(item.id) ? 'bg-foreground/90' : 'bg-muted-foreground/30',
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={10}
              collisionPadding={12}
              className="pointer-events-none w-80 max-w-[calc(100vw-5rem)] rounded-xl bg-popover px-3 py-3 text-left text-sm leading-5 shadow-lg"
            >
              <p className="line-clamp-2 break-words font-medium">{item.label}</p>
              {item.preview && (
                <p className="mt-1.5 line-clamp-3 break-words text-muted-foreground">
                  {item.preview}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  )
}
