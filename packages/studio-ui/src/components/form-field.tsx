import type { ReactNode } from 'react'
export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  )
}
