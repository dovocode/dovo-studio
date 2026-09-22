// Adapted from Vercel AI Elements (MIT), packages/elements/src/conversation.tsx.
import { ArrowDown } from 'lucide-react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { useEffect, useState, type ComponentProps } from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden', className)}
      initial="instant"
      resize="smooth"
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
  return <StickToBottom.Content className={cn('flex flex-col gap-6 p-6', className)} {...props} />
}
export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  return (
    !isAtBottom && (
      <Button
        aria-label="Scroll to latest message"
        className="absolute bottom-3 left-1/2 rounded-full"
        size="icon"
        variant="outline"
        onClick={() => void scrollToBottom()}
      >
        <ArrowDown />
      </Button>
    )
  )
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
  const [hovered, setHovered] = useState<number | null>(null)
  const [visible, setVisible] = useState<Set<string>>(new Set())
  useEffect(() => {
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
          return next
        })
      },
      { root, threshold: 0 },
    )
    for (const item of items) {
      const element = document.getElementById(item.id)
      if (element && root.contains(element)) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [items, scrollRef])
  if (!items.length) return null
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={150}>
      <nav
        aria-label="Conversation turns"
        className="absolute bottom-12 left-0 top-6 hidden w-6 flex-col items-center justify-center overflow-y-auto py-1 md:flex"
      >
        {items.map((item, index) => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                aria-label={`Jump to turn ${index + 1}: ${item.label}`}
                aria-current={visible.has(item.id) ? 'location' : undefined}
                className="group flex min-h-[6px] w-5 flex-1 items-center justify-center rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                style={{ maxHeight: 7 }}
                onClick={() => {
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
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 'instant'
                      : 'smooth',
                  })
                }}
              >
                <span
                  style={{
                    width:
                      hovered === null
                        ? visible.has(item.id)
                          ? 10
                          : 8
                        : Math.abs(index - hovered) === 0
                          ? 17
                          : Math.abs(index - hovered) === 1
                            ? 13
                            : Math.abs(index - hovered) === 2
                              ? 10
                              : 8,
                  }}
                  className={cn(
                    'h-[2px] rounded-full transition-[width,background-color] duration-150 ease-out group-hover:bg-foreground/75 group-focus-visible:bg-foreground motion-reduce:transition-none',
                    visible.has(item.id) ? 'bg-foreground/80' : 'bg-muted-foreground/30',
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={10}
              collisionPadding={12}
              className="w-80 max-w-[calc(100vw-3rem)] rounded-xl bg-popover px-3 py-3 text-left text-xs leading-relaxed shadow-lg"
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
