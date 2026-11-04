import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown } from 'lucide-react'
import type { SettingsChange } from '@dovo/protocol'
import { Card } from '@dovo/web-ui/card'
import { Switch } from './components/ui/switch'
import { PageHeader } from './page-header'
import { useId, useRef, useState, useEffect, type ReactNode } from 'react'
import { Button } from './components/ui/button'
import { Disclosure } from './disclosure'

/** Settings page frame and row, in the label-left / control-right style of Codex and T3 Code. */
export function SettingsPage({
  title,
  description,
  children,
  local = false,
  storageInfo,
  beforeToolbar,
  toolbar,
  wide = false,
}: {
  title: string
  description: string
  children: ReactNode
  local?: boolean
  storageInfo?: ReactNode
  beforeToolbar?: ReactNode
  toolbar?: ReactNode
  wide?: boolean
}) {
  return (
    <section className="studio-settings-page flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-muted-foreground">Settings</span>
            <span aria-hidden="true" className="shrink-0 text-muted-foreground/50">
              /
            </span>
            <span className="truncate">{title}</span>
          </span>
        }
        heading={false}
      />
      <div
        role="region"
        aria-label={`${title} settings`}
        tabIndex={0}
        className="studio-settings-scroll min-h-0 flex-1 overflow-y-auto px-4 py-[var(--studio-settings-scroll-padding)] outline-none [--studio-settings-scroll-padding:1.75rem] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-10"
      >
        <div
          className={`studio-settings-content ${wide ? 'max-w-6xl' : 'max-w-3xl'} space-y-6 pb-24`}
        >
          <div className="studio-settings-intro space-y-2">
            <h1 className="text-xl leading-7 font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="max-w-[68ch] text-[0.8125rem] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
            {(local || storageInfo) && (
              <div className="studio-settings-storage flex flex-wrap items-center gap-2 text-[0.8125rem] leading-normal text-foreground/80">
                {local && (
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="size-3" aria-hidden="true" />
                    This device · saved automatically
                  </span>
                )}
                {storageInfo}
              </div>
            )}
          </div>
          {beforeToolbar}
          {toolbar && (
            <div className="studio-settings-toolbar sticky top-[calc(-1*var(--studio-settings-scroll-padding))] z-20 bg-background">
              {toolbar}
            </div>
          )}
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
  saveRequired = false,
}: {
  title: string
  description?: string
  children: ReactNode
  advanced?: boolean
  saveRequired?: boolean
}) {
  const id = useId()
  const content = (
    <Card asChild className="divide-y divide-border/50 rounded-none border-0 bg-transparent p-0">
      <div>{children}</div>
    </Card>
  )
  if (advanced)
    return (
      <Disclosure
        className="studio-settings-group"
        data-setting-label={title}
        title={
          <span>
            {title}
            {saveRequired && (
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                Save to apply
              </span>
            )}
            {description && (
              <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
                {description}
              </span>
            )}
          </span>
        }
      >
        {content}
      </Disclosure>
    )
  return (
    <section
      data-setting-label={title}
      tabIndex={-1}
      aria-labelledby={id}
      className="studio-settings-group scroll-mt-4 space-y-2 outline-none"
    >
      <div className="studio-settings-group-heading">
        <h2
          id={id}
          aria-label={saveRequired ? title : undefined}
          aria-describedby={saveRequired ? `${id}-save` : undefined}
          className="text-sm font-semibold tracking-tight"
        >
          {title}
          {saveRequired && (
            <span
              id={`${id}-save`}
              className="shrink-0 text-[11px] font-normal tracking-normal text-muted-foreground"
            >
              Save to apply
            </span>
          )}
        </h2>
        {description && (
          <p className="mt-1 break-words text-[0.8125rem] leading-relaxed text-muted-foreground">
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
      className="studio-setting-row flex scroll-mt-4 flex-col items-stretch justify-between gap-2 px-0 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[search-highlight]:bg-accent data-[search-highlight]:ring-2 data-[search-highlight]:ring-inset data-[search-highlight]:ring-ring"
    >
      <div className="studio-setting-copy min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5">
          <p id={`${id}-label`} className="text-[0.8125rem] font-medium">
            {label}
          </p>
          {source}
        </div>
        {description && (
          <p
            id={`${id}-description`}
            className="mt-1 break-words text-[0.8125rem] leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        className="studio-setting-control flex w-full min-w-0 max-w-full items-center justify-start"
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
  saveType = 'button',
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
  saveType?: 'button' | 'submit'
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
  if (!dirty && !saving)
    return (
      <div className="studio-settings-saved space-y-3 text-xs text-muted-foreground">
        <p role={saved ? 'status' : undefined} className="flex items-center gap-2">
          {saved && <Check className="size-3.5" aria-hidden="true" />}
          {saved ? 'Changes saved.' : description}
        </p>
        {children && (
          <Disclosure title="More settings actions">
            <div className="flex flex-wrap gap-2 pt-2">{children}</div>
          </Disclosure>
        )}
      </div>
    )
  const status = saving
    ? 'Saving…'
    : dirty
      ? `${count} unsaved ${count === 1 ? 'change' : 'changes'}`
      : saved
        ? 'Changes saved.'
        : description
  return (
    <div
      className="studio-settings-savebar sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-none border-t border-border/70 bg-background py-3 shadow-none"
      role="group"
      aria-label="Settings save actions"
      aria-busy={saving}
    >
      <div role="status" className="w-full min-w-0 text-xs sm:w-auto sm:flex-1">
        <div className="flex min-h-6 items-center gap-2 font-medium">
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
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-foreground/80">{description}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button type="button" variant="ghost" size="sm" aria-label="More settings actions">
                More <ChevronDown className="size-3" aria-hidden="true" />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="top"
                align="end"
                sideOffset={8}
                className="studio-menu-surface z-50 w-64 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg"
              >
                {children}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
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
        <Button
          type={saveType}
          disabled={!dirty || saving || disabled}
          onClick={saveType === 'submit' ? undefined : onSave}
        >
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
      className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border/50 bg-background/60 p-1"
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
              ? 'studio-selected-surface font-medium'
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
