'use client'

// Adapted from Vercel AI Elements (MIT). Shared by Studio and hosted thread readers.
import { ArrowDown } from 'lucide-react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { useCallback, useLayoutEffect, type ComponentProps } from 'react'
import { cn } from './utils.js'
import { Button } from './button.js'

export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden', className)}
      initial="instant"
      resize="instant"
      role="log"
      defaultChecked
      {...props}
    />
  )
}
export function ConversationContent({
  className,
  ...props
}: ComponentProps<typeof StickToBottom.Content>) {
  const { scrollRef, contentRef, state } = useStickToBottomContext()
  const followLayout = useCallback(() => {
    // The asynchronous follow controller otherwise paints one frame at the old offset.
    // Respect detached readers, text selection and explicit animated navigation.
    if (!state.isAtBottom || (state.animation && state.animation.behavior !== 'instant')) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && scrollRef.current?.contains(selection.anchorNode))
      return
    // Use the controller's setter so this correction cannot be mistaken for a reader gesture.
    state.scrollTop = state.calculatedTargetScrollTop
  }, [scrollRef, state])
  useLayoutEffect(followLayout)
  // Older turn mounts, late Markdown/image measurements and composer resizes settle before paint.
  useLayoutEffect(() => {
    const root = scrollRef.current
    const content = contentRef.current
    if (!root || !content) return
    const observer = new ResizeObserver(followLayout)
    observer.observe(root)
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollRef, contentRef, followLayout])
  return <StickToBottom.Content className={cn('flex flex-col gap-4 p-4', className)} {...props} />
}

export function ConversationScrollButton({ reduceMotion }: { reduceMotion?: boolean }) {
  const { isAtBottom, scrollToBottom, scrollRef } = useStickToBottomContext()
  return (
    !isAtBottom && (
      <Button
        aria-label="Scroll to latest message"
        className="absolute bottom-3 right-3 rounded-full"
        size="icon"
        variant="outline"
        onClick={() => {
          // A search/turn jump can still be animating upward. Cancel that native animation
          // before the follow controller takes over, or its scroll events can escape the lock.
          const root = scrollRef.current
          root?.scrollTo({ top: root.scrollTop, behavior: 'instant' })
          void scrollToBottom({
            // Pending scroll/resize events from that jump must not cancel this explicit action.
            ignoreEscapes: true,
            animation:
              (reduceMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches)
                ? 'instant'
                : undefined,
          })
        }}
      >
        <ArrowDown />
      </Button>
    )
  )
}
