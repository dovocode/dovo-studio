import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
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
    [selected, setSelected] = useApplicationState(0)
  const origin = useRef<HTMLElement | null>(null)
  const executed = useRef(false)
  const search = query.trim().toLowerCase()
  const titleMatches: StudioCommand[] = []
  const aliasMatches: StudioCommand[] = []
  for (const command of commands) {
    if (command.title.toLowerCase().includes(search)) titleMatches.push(command)
    else if (command.aliases?.some((alias) => alias.toLowerCase().includes(search)))
      aliasMatches.push(command)
  }
  const filtered = [...titleMatches, ...aliasMatches]
  const index = Math.min(selected, Math.max(0, filtered.length - 1))
  useEffect(() => {
    if (open)
      document.getElementById(`command-option-${index}`)?.scrollIntoView({
        block: 'nearest',
      })
  }, [index, open, query])
  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected(0)
    }
  }, [open])
  const run = (command: StudioCommand) => {
    executed.current = true
    command.run()
    onOpenChange(false)
  }
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
            document.activeElement?.closest('[role="dialog"]')
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
            aria-activedescendant={filtered[index] ? `command-option-${index}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229 || e.defaultPrevented) return
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault()
                setSelected(
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? filtered.length - 1
                      : Math.max(
                          0,
                          Math.min(filtered.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)),
                        ),
                )
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
          {filtered.map((command, position) => (
            <Button
              key={command.id}
              id={`command-option-${position}`}
              role="option"
              aria-selected={position === index}
              onMouseMove={() => setSelected(position)}
              variant="ghost"
              className={`w-full justify-start rounded-lg border px-2.5 text-xs ${position === index ? 'border-primary/30 bg-[var(--studio-selected-fill)] text-foreground [background-image:var(--studio-selected-gradient)] [box-shadow:var(--studio-glow)]' : 'border-transparent text-muted-foreground'}`}
              onClick={() => run(command)}
            >
              {command.title}
            </Button>
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
