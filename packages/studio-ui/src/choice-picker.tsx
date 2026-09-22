import { Children, isValidElement, useId, useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
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
      isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint'
          ? String(child)
          : '',
    )
    .join('')
}
function choices(children: ReactNode): { value: string; label: string; disabled: boolean }[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; disabled?: boolean; children?: ReactNode }>(child))
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

/** Searchable selection with the same option markup used by simple form fields. */
export function ChoicePicker({
  value,
  onValueChange,
  children,
  disabled,
  className,
  'aria-label': label = 'Choose an option',
}: {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('')
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
          data-value={value}
          className={cn('h-9 w-full min-w-0 justify-between text-xs font-normal', className)}
        >
          <span className="truncate">
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
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            autoFocus
            role="combobox"
            aria-label={`Search ${label.toLowerCase()}`}
            aria-expanded="true"
            aria-controls={id}
            aria-autocomplete="list"
            aria-activedescendant={current ? `${id}-${options.indexOf(current)}` : undefined}
            className="pl-9"
            placeholder="Search…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive('')
            }}
            onKeyDown={(event) => {
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
                  document
                    .getElementById(`${id}-${options.indexOf(option)}`)
                    ?.scrollIntoView({ block: 'nearest' })
                }
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                if (current) choose(current.value)
              }
            }}
          />
        </div>
        <div id={id} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
          {filtered.map((option) => (
            <button
              key={option.value}
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
