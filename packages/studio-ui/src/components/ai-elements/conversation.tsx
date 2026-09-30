import { useApplicationState } from '@dovo/studio-core/state'
// Adapted from Vercel AI Elements (MIT), packages/elements/src/conversation.tsx.
import { ArrowDown } from 'lucide-react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { useEffect, type ComponentProps } from 'react'
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
  return <StickToBottom.Content className={cn('flex flex-col gap-4 p-4', className)} {...props} />
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
  const [hovered, setHovered] = useApplicationState<string | null>(null)
  const hoverIndex = items.findIndex((item) => item.id === hovered)
  const [visible, setVisible] = useApplicationState<Set<string>>(new Set())
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
      {
        root,
        threshold: 0,
      },
    )
    for (const item of items) {
      const element = document.getElementById(item.id)
      if (element && root.contains(element)) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [items, scrollRef])
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
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 'instant'
                      : 'smooth',
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
