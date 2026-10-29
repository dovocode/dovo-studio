import { useAppPreferences } from '@dovo/studio-core'
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { ArrowUp, LoaderCircle } from 'lucide-react'
import {
  PromptInput,
  PromptInputFooter,
  PromptInputTools,
  PromptInputTextarea,
  PromptInputSubmit,
} from './components/ai-elements/prompt-input'
import { MessageResponse } from './components/ai-elements/message'
import { cn } from './lib/utils'

/** Shared presentation; callers own drafts, task lifecycle and submission. */
export function ComposerSurface({
  children,
  controls,
  leadingActions,
  actions,
  error,
  collapsed = false,
  compact = false,
  className,
  ...props
}: ComponentProps<typeof PromptInput> & {
  controls: ReactNode
  leadingActions?: ReactNode
  actions: ReactNode
  error?: string
  collapsed?: boolean
  compact?: boolean
}) {
  const surface = useRef<HTMLFormElement>(null)
  const animateLayout = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => {
    const form = surface.current
    if (!form?.closest('.task-composer') || collapsed) return
    const measure = () =>
      [
        form,
        ...form.querySelectorAll<HTMLElement>(
          ':scope > textarea, [data-composer-leading], [data-composer-controls], [data-composer-actions], [data-composer-footer] button',
        ),
      ].map((element) => ({
        element,
        bounds: element.getBoundingClientRect(),
        padding: element.tagName === 'TEXTAREA' ? getComputedStyle(element).padding : undefined,
        parent: element.matches('button')
          ? element.closest<HTMLElement>(
              '[data-composer-leading], [data-composer-controls], [data-composer-actions]',
            )
          : form,
      }))
    const isIdle = () => form.hasAttribute('data-idle')
    let idle = isIdle()
    let previous = measure()
    let animations: Animation[] = []
    // Animate the layout change without scaling text or icons. Natural content sizing still
    // owns the expanded height, and an interrupted transition starts from its current frame.
    const updateLayout = () => {
      const nextIdle = isIdle()
      if (idle !== nextIdle) {
        idle = nextIdle
        // Read the current visual frame before cancelling an in-flight transition.
        // ResizeObserver may still hold the previous frame when focus changes again.
        if (animations.some((animation) => animation.playState === 'running')) previous = measure()
        animations.forEach((animation) => animation.cancel())
        const next = measure()
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const timing = { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          const previousSurface = previous[0].bounds
          const nextSurface = next[0].bounds
          form.setAttribute('data-layout-animating', '')
          animations = next.map(({ element, bounds, padding, parent }, index) => {
            if (index === 0)
              return element.animate(
                [{ height: `${previousSurface.height}px` }, { height: `${nextSurface.height}px` }],
                timing,
              )
            const previousElement = previous.find((entry) => entry.element === element)
            const before = previousElement?.bounds
            if (!before?.width || !bounds.width)
              return element.animate(
                [
                  { opacity: 0, transform: 'translateY(6px)' },
                  { opacity: 1, transform: 'translateY(0)' },
                ],
                timing,
              )
            // Children move relative to their animated toolbar group, so model/effort and
            // wrapped actions do not jump inside a group that is itself moving.
            const previousParent =
              previous.find((entry) => entry.element === parent)?.bounds ?? previousSurface
            const nextParent = next.find((entry) => entry.element === parent)?.bounds ?? nextSurface
            const x = before.x - previousParent.x - (bounds.x - nextParent.x)
            const y = before.y - previousParent.y - (bounds.y - nextParent.y)
            return element.animate(
              [
                {
                  transform: `translate(${x}px, ${y}px)`,
                  padding: previousElement?.padding,
                  height: padding ? `${before.height}px` : undefined,
                  minHeight: padding ? `${before.height}px` : undefined,
                  maxHeight: padding ? `${Math.max(before.height, bounds.height)}px` : undefined,
                },
                {
                  transform: 'translate(0, 0)',
                  padding,
                  height: padding ? `${bounds.height}px` : undefined,
                  minHeight: padding ? `${bounds.height}px` : undefined,
                  maxHeight: padding ? `${Math.max(before.height, bounds.height)}px` : undefined,
                },
              ],
              timing,
            )
          })
          const surfaceAnimation = animations[0]
          surfaceAnimation.onfinish = () => {
            if (animations[0] !== surfaceAnimation) return
            form.removeAttribute('data-layout-animating')
            previous = measure()
          }
        } else {
          form.removeAttribute('data-layout-animating')
        }
      }
      previous = measure()
    }
    animateLayout.current = updateLayout
    const observer = new ResizeObserver(updateLayout)
    observer.observe(form)
    return () => {
      observer.disconnect()
      form.removeAttribute('data-layout-animating')
      animations.forEach((animation) => animation.cancel())
      animateLayout.current = undefined
    }
  }, [collapsed])
  useLayoutEffect(() => animateLayout.current?.())
  return (
    <PromptInput
      ref={surface}
      data-idle={compact || undefined}
      className={cn(
        'studio-composer relative z-10 mx-auto overflow-visible max-w-[var(--chat-max)] rounded-xl border-border/70 bg-card shadow-none',
        collapsed && 'max-h-12 overflow-hidden',
        className,
      )}
      {...props}
    >
      {children}
      <PromptInputFooter
        data-composer-footer=""
        className="flex-wrap items-center gap-1.5 px-2.5 pb-2 pt-1"
      >
        {leadingActions && (
          <div data-composer-leading="" className="flex shrink-0 items-center gap-1">
            {leadingActions}
          </div>
        )}
        <PromptInputTools
          data-composer-controls=""
          className="min-w-[min(100%,18rem)] flex-1 flex-wrap gap-0.5"
        >
          {controls}
        </PromptInputTools>
        <div
          data-composer-actions=""
          className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2"
        >
          {actions}
        </div>
      </PromptInputFooter>
      {error && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </PromptInput>
  )
}

export function ComposerTextarea({
  value,
  hidden,
  className,
  ...props
}: ComponentProps<typeof PromptInputTextarea> & { value: string; hidden?: boolean }) {
  const { markdownComposerPreview } = useAppPreferences()
  return (
    <>
      {!hidden && markdownComposerPreview && value.trim() && (
        <div
          aria-label="Formatted message preview"
          className="max-h-40 overflow-y-auto border-b px-4 py-3 text-sm"
        >
          <MessageResponse>{value}</MessageResponse>
        </div>
      )}
      <PromptInputTextarea
        className={cn('min-h-24 max-h-64 px-4 pt-4 pb-2', hidden && 'hidden', className)}
        value={value}
        {...props}
      />
    </>
  )
}

export function ComposerSubmit({
  busy,
  children,
  className,
  ...props
}: ComponentProps<typeof PromptInputSubmit>) {
  return (
    <PromptInputSubmit
      busy={busy}
      className={cn(
        'size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-35',
        className,
      )}
      {...props}
    >
      {children ??
        (busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />)}
    </PromptInputSubmit>
  )
}

export function ComposerWorkspaceBar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="group"
      aria-label="Project and checkout"
      data-composer-workspace=""
      className={cn(
        'relative mx-auto -mt-3 flex w-[calc(100%-24px)] max-w-[calc(var(--chat-max)-1.5rem)] flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-b-xl border border-t-0 bg-muted/15 px-2 pb-1 pt-3.5 text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
