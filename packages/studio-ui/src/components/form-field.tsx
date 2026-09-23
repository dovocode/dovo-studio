import type { ReactNode } from 'react'
export function FormField({
  label,
  children,
  error,
}: {
  label: string
  children: ReactNode
  error?: string
}) {
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
