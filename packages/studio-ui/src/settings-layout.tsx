import { Card } from '@dovo/web-ui/card'
import { Switch } from './components/ui/switch'
import { PageHeader } from './page-header'
import { useId, useRef, type ReactNode } from 'react'

/** Settings page frame and row, in the label-left / control-right style of Codex and T3 Code. */
export function SettingsPage({
  title,
  description,
  children,
  local = false,
  headerActions,
  toolbar,
  wide = false,
}: {
  title: string
  description: string
  children: ReactNode
  local?: boolean
  headerActions?: ReactNode
  toolbar?: ReactNode
  wide?: boolean
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader title={title} description={description}>
        {local && (
          <span className="rounded-md border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
            This device · saved automatically
          </span>
        )}
        {headerActions}
      </PageHeader>
      {toolbar}
      <div
        role="region"
        aria-label={`${title} settings`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
      >
        <div className={`mx-auto ${wide ? 'max-w-6xl' : 'max-w-3xl'} space-y-4`}>{children}</div>
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
  const id = useId()
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div>
        <h2 id={id} className="text-sm font-semibold tracking-tight">
          {title}
        </h2>
        {description && (
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Card asChild className="divide-y p-0">
        <div>{children}</div>
      </Card>
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
  const id = useId()
  return (
    <div className="flex flex-col items-stretch justify-between gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5">
          <p id={`${id}-label`} className="text-[0.8125rem] font-medium">
            {label}
          </p>
          {source}
        </div>
        {description && (
          <p
            id={`${id}-description`}
            className="mt-1 break-words text-xs leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        className="flex w-full max-w-full items-center justify-end sm:w-auto sm:min-w-36 sm:max-w-[50%] sm:shrink-0"
      >
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
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border p-0.5">
      {options.map(([id, name], index) => (
        <button
          key={id}
          ref={(button) => {
            buttons.current[index] = button
          }}
          tabIndex={value === id ? 0 : -1}
          onKeyDown={(event) => {
            if (
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                event.key,
              )
            )
              return
            event.preventDefault()
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (index +
                      (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) +
                      options.length) %
                    options.length
            const option = options[next]
            if (option) {
              onChange(option[0])
              buttons.current[next]?.focus()
            }
          }}
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
    <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  )
}
