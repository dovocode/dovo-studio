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
      <h2 className="max-w-sm text-base font-semibold tracking-tight text-balance">{title}</h2>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
      {action && (
        <div className="mt-2 flex max-w-full flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  )
}
