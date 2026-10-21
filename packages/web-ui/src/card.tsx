import type { ComponentProps } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from './utils.js'

export function Card({
  className,
  asChild = false,
  ...props
}: ComponentProps<'section'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'section'
  return (
    <Comp
      data-slot="card"
      className={cn('rounded-xl border border-border bg-card text-card-foreground p-6', className)}
      {...props}
    />
  )
}
