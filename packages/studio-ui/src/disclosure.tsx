import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from './lib/utils'

/** Native disclosure semantics with one quiet, keyboard-accessible treatment. */
export function Disclosure({
  title,
  children,
  className,
  'data-setting-label': settingLabel,
  ...props
}: Omit<ComponentPropsWithoutRef<'details'>, 'title'> & {
  title: ReactNode
  'data-setting-label'?: string
}) {
  return (
    <details
      {...props}
      data-setting-label={settingLabel}
      className={cn('studio-disclosure', className)}
    >
      <summary
        data-setting-label={settingLabel}
        className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown aria-hidden="true" />
        <span className="min-w-0 break-words">{title}</span>
      </summary>
      {children}
    </details>
  )
}
