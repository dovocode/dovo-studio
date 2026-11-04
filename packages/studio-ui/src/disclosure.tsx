import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from './lib/utils'

/** Native disclosure semantics with one quiet, keyboard-accessible treatment. */
export function Disclosure({
  title,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'details'>, 'title'> & { title: ReactNode }) {
  return (
    <details {...props} className={cn('studio-disclosure', className)}>
      <summary>
        <ChevronDown aria-hidden="true" />
        <span>{title}</span>
      </summary>
      {children}
    </details>
  )
}
