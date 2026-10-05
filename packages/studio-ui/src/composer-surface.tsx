import { useAppPreferences } from '@dovo/studio-core'
import type { ComponentProps, ReactNode } from 'react'
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
  actions,
  error,
  collapsed = false,
  className,
  ...props
}: ComponentProps<typeof PromptInput> & {
  controls: ReactNode
  actions: ReactNode
  error?: string
  collapsed?: boolean
}) {
  return (
    <PromptInput
      className={cn(
        'studio-composer relative z-10 mx-auto max-w-[var(--chat-max)] rounded-2xl border-border/70 bg-card shadow-none',
        collapsed && 'max-h-12 overflow-hidden',
        className,
      )}
      {...props}
    >
      {children}
      <PromptInputFooter className="flex-wrap items-center gap-1.5 px-2.5 pb-2 pt-1">
        <PromptInputTools className="min-w-[min(100%,18rem)] flex-1 flex-wrap gap-0.5">
          {controls}
        </PromptInputTools>
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
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
        'size-8 rounded-full bg-[#326bf3] text-white hover:bg-[#326bf3]/90 disabled:opacity-35',
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
      className={cn(
        'relative mx-auto -mt-3 flex w-[calc(100%-24px)] max-w-[calc(var(--chat-max)-1.5rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-b-xl border border-t-0 bg-muted/15 px-2 pb-1.5 pt-4 text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
