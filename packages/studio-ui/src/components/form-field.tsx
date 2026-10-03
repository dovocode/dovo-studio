import type { ReactNode } from 'react'
export function FormField({
  label,
  children,
  error,
  layout,
}: {
  label: string
  children: ReactNode
  error?: string
  layout?: 'settings'
}) {
  if (layout === 'settings')
    return (
      <label className="grid gap-3 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(10rem,1fr)_minmax(0,1.5fr)] sm:items-start">
        <span className="pt-2">{label}</span>
        <div className="min-w-0 space-y-2">{children}</div>
        {error && (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        )}
      </label>
    )
  return (
    <label className="grid gap-2 text-xs font-medium text-muted-foreground">
      {label}
      {children}
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </label>
  )
}
