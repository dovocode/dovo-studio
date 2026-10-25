'use client'

// Adapted from Vercel AI Elements (MIT). Shared by Studio and hosted thread readers.
import { ArrowDown } from 'lucide-react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { useEffect, type ComponentProps } from 'react'
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
  const { scrollRef, scrollToBottom } = useStickToBottomContext()
  // The viewport also resizes when the composer, keyboard or browser window changes.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const observer = new ResizeObserver(() => {
      void scrollToBottom({ animation: 'instant', preserveScrollPosition: true })
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [scrollRef, scrollToBottom])
  return <StickToBottom.Content className={cn('flex flex-col gap-4 p-4', className)} {...props} />
}

export function ConversationScrollButton({ reduceMotion }: { reduceMotion?: boolean }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  return (
    !isAtBottom && (
      <Button
        aria-label="Scroll to latest message"
        className="absolute bottom-3 left-1/2 rounded-full"
        size="icon"
        variant="outline"
        onClick={() =>
          void scrollToBottom({
            animation:
              (reduceMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches)
                ? 'instant'
                : undefined,
          })
        }
      >
        <ArrowDown />
      </Button>
    )
  )
}
