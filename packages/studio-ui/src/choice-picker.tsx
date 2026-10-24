import { useApplicationState } from '@dovo/studio-core/state'
import { Children, isValidElement, useId, type ReactNode } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from './components/ui/button'
import { SearchField } from './search-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog'
import { cn } from './lib/utils'
function textContent(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{
        children?: ReactNode
      }>(child)
        ? textContent(child.props.children)
        : typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint'
          ? String(child)
          : '',
    )
    .join('')
}
function choices(children: ReactNode): {
  value: string
  label: string
  disabled: boolean
}[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string
        disabled?: boolean
        children?: ReactNode
      }>(child)
    )
      return []
    if (child.type !== 'option') return choices(child.props.children)
    return [
      {
        value: child.props.value ?? textContent(child.props.children),
        label: textContent(child.props.children),
        disabled: !!child.props.disabled,
      },
    ]
  })
}

// Scroll only the results, keeping the dialog and its search field anchored.
function revealOption(node: HTMLButtonElement | null) {
  const list = node?.parentElement
  if (!node || !list) return
  const row = node.getBoundingClientRect()
  const viewport = list.getBoundingClientRect()
  if (row.top < viewport.top) list.scrollTop -= viewport.top - row.top
  else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom
}

/** Searchable selection with the same option markup used by simple form fields. */
export function ChoicePicker({
  value,
  onValueChange,
  children,
  icons,
  disabled,
  className,
  'aria-label': label = 'Choose an option',
}: {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
  icons?: Readonly<Record<string, ReactNode>>
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  const [open, setOpen] = useApplicationState(false)
  const [query, setQuery] = useApplicationState('')
  const [active, setActive] = useApplicationState<string | null>(null)
  const id = useId()
  const options = choices(children)
  const filtered = options.filter((option) =>
    `${option.label} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const available = filtered.filter((option) => !option.disabled)
  const current = available.find((option) => option.value === active) ?? available[0]
  const choose = (next: string) => {
    onValueChange(next)
    setOpen(false)
  }
  return (
    <Dialog
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next)
        setQuery('')
        setActive(value)
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={label}
          aria-describedby={`${id}-value`}
          data-value={value}
          className={cn('h-9 w-full min-w-0 justify-between text-xs font-normal', className)}
        >
          {icons?.[value] && (
            <span className="shrink-0" aria-hidden="true">
              {icons[value]}
            </span>
          )}
          <span id={`${id}-value`} className="min-w-0 flex-1 truncate text-left">
            {options.find((option) => option.value === value)?.label ?? (value || 'Choose…')}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-3 p-4 sm:max-w-md">
        <DialogTitle className="text-sm">{label}</DialogTitle>
        <DialogDescription className="sr-only">
          Search options. Use arrow keys and Enter to select.
        </DialogDescription>
        <SearchField
          autoFocus
          role="combobox"
          aria-label={`Search ${label.toLowerCase()}`}
          aria-expanded="true"
          aria-controls={id}
          aria-autocomplete="list"
          aria-activedescendant={current ? `${id}-${options.indexOf(current)}` : undefined}
          placeholder="Search…"
          value={query}
          onValueChange={(next) => {
            setQuery(next)
            setActive(null)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const index = current ? available.indexOf(current) : 0
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? available.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + available.length) %
                      available.length
              const option = available[next]
              if (option) {
                setActive(option.value)
              }
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              if (current) choose(current.value)
            }
          }}
        />
        <div
          id={id}
          role="listbox"
          aria-label={label}
          className="overflow-y-auto"
          style={{ height: `min(${Math.max(44, Math.min(288, options.length * 44))}px, 50dvh)` }}
        >
          {filtered.map((option) => (
            <button
              key={option.value}
              ref={current === option ? revealOption : undefined}
              id={`${id}-${options.indexOf(option)}`}
              type="button"
              role="option"
              data-value={option.value}
              aria-selected={value === option.value}
              disabled={option.disabled}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm disabled:opacity-40',
                current === option && 'bg-accent',
                !option.disabled && 'hover:bg-accent',
              )}
            >
              {icons?.[option.value] && (
                <span className="shrink-0" aria-hidden="true">
                  {icons[option.value]}
                </span>
              )}
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {value === option.value && <Check className="size-4 shrink-0" />}
            </button>
          ))}
          {!filtered.length && (
            <p role="status" className="p-6 text-center text-sm text-muted-foreground">
              No matching options.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
