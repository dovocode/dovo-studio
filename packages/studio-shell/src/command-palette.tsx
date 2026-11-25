import { useApplicationState } from '@dovo/studio-core/state'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import type { StudioCommand } from '@dovo/studio-core'
import { Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Button,
} from '@dovo/studio-ui'

function optionId(id: string) {
  return `command-option-${encodeURIComponent(id)}`
}

const CommandOption = memo(function CommandOption({
  command,
  selected,
  select,
  run,
}: {
  command: StudioCommand
  selected: boolean
  select: (id: string) => void
  run: (command: StudioCommand) => void
}) {
  return (
    <Button
      id={optionId(command.id)}
      role="option"
      aria-selected={selected}
      onMouseMove={() => select(command.id)}
      variant="ghost"
      className={`w-full justify-start rounded-lg border px-2.5 text-xs ${selected ? 'border-primary/30 bg-[var(--studio-selected-fill)] text-foreground [background-image:var(--studio-selected-gradient)] [box-shadow:var(--studio-glow)]' : 'border-transparent text-muted-foreground'}`}
      onClick={() => run(command)}
    >
      {command.title}
    </Button>
  )
})

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: readonly StudioCommand[]
}) {
  const [query, setQuery] = useApplicationState(''),
    [selected, setSelected] = useApplicationState<string | undefined>(undefined)
  const origin = useRef<HTMLElement | null>(null)
  const executed = useRef(false)
  const search = query.trim().toLowerCase()
  const items = useMemo(
    () =>
      commands.map((command) => ({
        command,
        title: command.title.toLowerCase(),
        aliases: command.aliases?.map((alias) => alias.toLowerCase()),
      })),
    [commands],
  )
  const filtered = useMemo(() => {
    const titleMatches: StudioCommand[] = []
    const aliasMatches: StudioCommand[] = []
    for (const { command, title, aliases } of items) {
      if (title.includes(search)) titleMatches.push(command)
      else if (aliases?.some((alias) => alias.includes(search))) aliasMatches.push(command)
    }
    return [...titleMatches, ...aliasMatches]
  }, [items, search])
  const index = Math.max(
    0,
    filtered.findIndex(({ id }) => id === selected),
  )
  const active = filtered[index]?.id
  useEffect(() => {
    if (open && active)
      document.getElementById(optionId(active))?.scrollIntoView({
        block: 'nearest',
      })
  }, [active, open, query])
  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected(undefined)
    }
  }, [open])
  const run = useCallback(
    (command: StudioCommand) => {
      executed.current = true
      command.run()
      onOpenChange(false)
    },
    [onOpenChange],
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-3 p-4"
        onOpenAutoFocus={() => {
          origin.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
          executed.current = false
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!executed.current && origin.current?.getClientRects().length) {
            origin.current.focus({
              preventScroll: true,
            })
          } else if (
            document.activeElement === document.body ||
            (event.currentTarget instanceof HTMLElement &&
              event.currentTarget.contains(document.activeElement))
          ) {
            document.querySelector<HTMLElement>('.studio-main')?.focus({
              preventScroll: true,
            })
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">Commands</DialogTitle>
          <DialogDescription className="sr-only">
            Search commands contributed by extensions.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-9"
            aria-label="Search commands"
            placeholder="What would you like to do?"
            value={query}
            role="combobox"
            aria-expanded={open}
            aria-controls="command-options"
            aria-activedescendant={active ? optionId(active) : undefined}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(undefined)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229 || e.defaultPrevented) return
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault()
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? filtered.length - 1
                      : Math.max(
                          0,
                          Math.min(filtered.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)),
                        )
                setSelected(filtered[next]?.id)
              }
              if (e.key === 'Enter' && filtered[index]) {
                e.preventDefault()
                run(filtered[index])
              }
            }}
          />
        </div>
        <div
          id="command-options"
          role="listbox"
          aria-label="Commands"
          className="max-h-80 space-y-0.5 overflow-y-auto overscroll-contain p-0.5"
        >
          {filtered.map((command) => (
            <CommandOption
              key={command.id}
              command={command}
              selected={command.id === active}
              select={setSelected}
              run={run}
            />
          ))}
          {!filtered.length && (
            <p className="p-4 text-xs text-muted-foreground">No matching commands.</p>
          )}
        </div>
        <div
          aria-hidden="true"
          className="flex items-center gap-3 border-t border-border/50 pt-2 text-[0.6875rem] text-muted-foreground"
        >
          <span>↑ ↓ Navigate</span>
          <span>↵ Run</span>
          <span className="ml-auto">Esc Close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
