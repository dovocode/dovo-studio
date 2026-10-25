// Adapted from Vercel AI Elements (MIT). Shared by Studio and hosted thread readers.
import type { HTMLAttributes } from 'react'
import { cn } from './utils.js'

export function Message({
  from,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { from: 'user' | 'assistant' }) {
  return (
    <div
      className={cn(
        'group flex w-full flex-col gap-2',
        from === 'user' ? 'is-user ml-auto max-w-[90%]' : 'is-assistant',
        className,
      )}
      {...props}
    />
  )
}
export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm group-[.is-user]:ml-auto group-[.is-user]:rounded-2xl group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}
