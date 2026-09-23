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
    <div className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      {icon && <div className="studio-empty-icon">{icon}</div>}
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
      {action}
    </div>
  )
}
