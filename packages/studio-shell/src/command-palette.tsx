import { useEffect, useRef, useState } from 'react'
import type { StudioCommand } from '@dovo/studio-core'
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
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(0)
  const origin = useRef<HTMLElement | null>(null)
  const executed = useRef(false)
  const filtered = commands.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
  const index = Math.min(selected, Math.max(0, filtered.length - 1))
  useEffect(() => {
    if (open)
      document.getElementById(`command-option-${index}`)?.scrollIntoView({ block: 'nearest' })
  }, [index, open])
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
            origin.current.focus({ preventScroll: true })
          } else if (
            document.activeElement === document.body ||
            document.activeElement?.closest('[role="dialog"]')
          ) {
            document.querySelector<HTMLElement>('.studio-main')?.focus({ preventScroll: true })
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">Commands</DialogTitle>
          <DialogDescription className="sr-only">
            Search commands contributed by extensions.
          </DialogDescription>
        </DialogHeader>
        <Input
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
            if (e.nativeEvent.isComposing || e.defaultPrevented) return
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
        <div
          id="command-options"
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto"
        >
          {filtered.map((command, position) => (
            <Button
              key={command.id}
              id={`command-option-${position}`}
              role="option"
              aria-selected={position === index}
              onMouseMove={() => setSelected(position)}
              variant="ghost"
              className={`w-full justify-start text-xs ${position === index ? 'bg-accent' : ''}`}
              onClick={() => run(command)}
            >
              {command.title}
            </Button>
          ))}
          {!filtered.length && (
            <p className="p-4 text-xs text-muted-foreground">No matching commands.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
