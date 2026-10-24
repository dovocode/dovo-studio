import type { SettingsChange } from '@dovo/protocol'
import { Card } from '@dovo/web-ui/card'
import { Switch } from './components/ui/switch'
import { PageHeader } from './page-header'
import { useId, useRef, useState, useEffect, type ReactNode } from 'react'
import { Button } from './components/ui/button'
import { ChevronDown } from 'lucide-react'

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
      {toolbar && (
        <div className="shrink-0 overflow-y-hidden [scrollbar-gutter:stable]">{toolbar}</div>
      )}
      <div
        role="region"
        aria-label={`${title} settings`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
      >
        <div className={`mx-auto ${wide ? 'max-w-6xl' : 'max-w-3xl'} space-y-6 pb-24`}>
          {children}
        </div>
      </div>
    </section>
  )
}
export function SettingsGroup({
  title,
  description,
  children,
  advanced = false,
}: {
  title: string
  description?: string
  children: ReactNode
  advanced?: boolean
}) {
  const id = useId()
  const content = (
    <Card asChild className="divide-y divide-border/60 p-0">
      <div>{children}</div>
    </Card>
  )
  if (advanced)
    return (
      <details className="studio-settings-group group space-y-3">
        <summary
          data-setting-label={title}
          className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-1 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        >
          <span className="min-w-0 flex-1">
            {title}
            {description && (
              <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
                {description}
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground group-open:rotate-180"
          />
        </summary>
        {content}
      </details>
    )
  return (
    <section
      data-setting-label={title}
      tabIndex={-1}
      aria-labelledby={id}
      className="studio-settings-group scroll-mt-4 space-y-3 outline-none"
    >
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
      {content}
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
    <div
      data-setting-label={label}
      tabIndex={-1}
      className="flex scroll-mt-4 flex-col items-stretch justify-between gap-2 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[search-highlight]:bg-accent data-[search-highlight]:ring-2 data-[search-highlight]:ring-inset data-[search-highlight]:ring-ring sm:flex-row sm:items-center sm:gap-4"
    >
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

/** Explicit-save editors share status, discard behavior and persistent actions. */
export function SettingsSaveBar({
  dirty,
  saving,
  saveLabel = 'Save changes',
  disabled,
  saved,
  description,
  onSave,
  onDiscard,
  children,
  changeCount,
  changes = [],
  saveError,
  readLatestChanges,
}: {
  changeCount?: number
  changes?: SettingsChange[]
  saveError?: string
  readLatestChanges?: () => Promise<SettingsChange[]>
  saveLabel?: string
  dirty: boolean
  saving: boolean
  disabled?: boolean
  saved?: boolean
  description: string
  onSave: () => void
  onDiscard: () => void
  children?: ReactNode
}) {
  const [review, setReview] = useState(false)
  const [latest, setLatest] = useState<SettingsChange[] | null>(null)
  const [reviewError, setReviewError] = useState('')
  const reader = useRef(readLatestChanges)
  reader.current = readLatestChanges
  useEffect(() => {
    setLatest(null)
    setReviewError('')
    if (!saveError || !dirty || !reader.current) return
    let active = true
    void reader.current().then(
      (value) => {
        if (active) {
          setLatest(value)
          setReview(true)
        }
      },
      (error: unknown) => {
        if (active) setReviewError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => {
      active = false
    }
  }, [saveError, dirty])
  const count = changeCount || changes.length || 1
  const status = saving
    ? 'Saving…'
    : dirty
      ? `${count} unsaved ${count === 1 ? 'change' : 'changes'}`
      : saved
        ? 'Changes saved.'
        : description
  return (
    <div
      className={`sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 bg-background/95 backdrop-blur ${dirty || saving ? 'border-border shadow-sm' : 'border-transparent border-t-border text-muted-foreground'}`}
      role="group"
      aria-label="Settings save actions"
      aria-busy={saving}
    >
      <div
        role="status"
        className="flex min-h-8 w-full min-w-0 items-center gap-2 text-xs text-muted-foreground sm:w-auto sm:flex-1"
      >
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full bg-status-warning ${dirty ? '' : 'invisible'}`}
        />
        {dirty && changes.length > 0 ? (
          <button
            type="button"
            className="rounded px-1 py-2 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={review}
            onClick={() => setReview((value) => !value)}
          >
            {status}
          </button>
        ) : (
          status
        )}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children && (
          <details className="relative">
            <summary
              className="cursor-pointer rounded-md px-2 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="More settings actions"
            >
              More
            </summary>
            <div className="absolute bottom-full right-0 mb-2 w-64 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg">
              {children}
            </div>
          </details>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || saving}
          onClick={onDiscard}
        >
          Discard
        </Button>
        <Button type="button" disabled={!dirty || saving || disabled} onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
      {dirty && review && (
        <div
          className="max-h-64 w-full space-y-3 overflow-auto text-xs"
          aria-label="Settings change review"
        >
          <p className="font-medium">Your changes</p>
          {changes.map((change) => (
            <div key={change.key} className="break-words [overflow-wrap:anywhere]">
              <p className="font-medium">{change.label}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {change.before} → {change.after}
              </p>
            </div>
          ))}
          {latest && (
            <>
              <p className="font-medium">Latest saved changes · your draft is kept</p>
              {latest.length ? (
                latest.map((change) => (
                  <div key={change.key} className="break-words [overflow-wrap:anywhere]">
                    <p className="font-medium">{change.label}</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {change.before} → {change.after}
                    </p>
                  </div>
                ))
              ) : (
                <p>No remotely changed fields found.</p>
              )}
              <p>Discard and reload to use the latest saved settings.</p>
            </>
          )}
        </div>
      )}
      {reviewError && (
        <p role="alert" className="w-full text-xs text-destructive">
          Could not read latest saved changes: {reviewError}. Your draft is kept.
        </p>
      )}
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
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-muted/50 p-1"
    >
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
          className={`min-h-7 rounded-md border px-3 py-1 text-xs transition-colors pointer-coarse:min-h-11 ${
            value === id
              ? 'border-border bg-background font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-background/50 hover:text-foreground'
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
