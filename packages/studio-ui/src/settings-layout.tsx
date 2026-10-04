import { PageHeader } from './page-header'
import type { ReactNode } from 'react'

/** Settings page frame and row, in the label-left / control-right style of Codex and T3 Code. */
export function SettingsPage({
  title,
  description,
  children,
  local = false,
}: {
  title: string
  description: string
  children: ReactNode
  local?: boolean
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title={title} description={description}>
        {local && (
          <span className="rounded-md border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
            This device · saved automatically
          </span>
        )}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-3xl space-y-6">{children}</div>
      </div>
    </section>
  )
}
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="divide-y rounded-xl border bg-card/30">{children}</div>
    </section>
  )
}
export function SettingRow({
  label,
  description,
  source,
  children,
}: {
  label: string
  description?: ReactNode
  source?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col items-stretch justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-medium">{label}</p>
        {description && (
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {source && <div className="mt-2">{source}</div>}
      </div>
      <div className="flex w-full max-w-full items-center justify-end sm:w-auto sm:min-w-36 sm:max-w-[50%] sm:shrink-0">
        {children}
      </div>
    </div>
  )
}
/** A small segmented control for 2–3 mutually exclusive choices. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly [T, string][]
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border p-0.5">
      {options.map(([id, name]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`rounded px-3 py-1 text-xs transition-colors ${
            value === id
              ? 'bg-accent font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  )
}
export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full p-0 transition-colors disabled:opacity-40 ${checked ? 'bg-primary' : 'bg-muted-foreground/35'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
