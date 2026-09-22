import type { ReactNode } from 'react'
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="max-w-sm text-xs leading-6 text-muted-foreground">{description}</p>
      {action}
    </div>
  )
}
