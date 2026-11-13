import { Bot } from 'lucide-react'
import { cn } from './lib/utils'

export function BotAvatar({
  avatar,
  name,
  className,
}: {
  avatar?: string
  name: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-muted text-muted-foreground',
        className,
      )}
    >
      {avatar ? (
        <img src={avatar} alt={`${name} avatar`} className="size-full object-cover" />
      ) : (
        <Bot className="size-6" aria-hidden="true" />
      )}
    </span>
  )
}
