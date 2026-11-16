import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { BrowserNavigationHistory } from '@dovo/protocol'
import { IconButton, Popover } from '@dovo/studio-ui'

type Entry = BrowserNavigationHistory['entries'][number]

export function BrowserHistoryButton({
  direction,
  disabled,
  navigate,
  loadHistory,
  jump,
}: {
  direction: 'back' | 'forward'
  disabled: boolean
  navigate: () => void
  loadHistory: () => Promise<BrowserNavigationHistory | undefined>
  jump: (entry: Entry) => Promise<void>
}) {
  const label = direction === 'back' ? 'Back' : 'Forward'
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const held = useRef(false)
  const generation = useRef(0)
  const cancel = () => clearTimeout(timer.current)
  useEffect(
    () => () => {
      cancel()
      generation.current++
    },
    [],
  )
  useEffect(() => {
    if (disabled) {
      cancel()
      setOpen(false)
      generation.current++
    }
  }, [disabled])
  const showHistory = async () => {
    cancel()
    held.current = true
    const current = ++generation.current
    setOpen(true)
    setBusy(true)
    setError('')
    setEntries([])
    try {
      const history = await loadHistory()
      if (current !== generation.current) return
      setEntries(
        !history
          ? []
          : direction === 'back'
            ? history.entries.slice(0, history.currentIndex).reverse()
            : history.entries.slice(history.currentIndex + 1),
      )
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <IconButton
          label={label}
          type="button"
          className="size-8 shrink-0"
          disabled={disabled}
          title={`${label}. Hold to show history.`}
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            held.current = false
            timer.current = setTimeout(() => void showHistory(), 500)
          }}
          onPointerUp={cancel}
          onPointerCancel={cancel}
          onPointerLeave={cancel}
          onContextMenu={(event) => {
            event.preventDefault()
            void showHistory()
          }}
          onKeyDown={(event) => {
            if (
              (event.altKey && event.key === 'ArrowDown') ||
              (event.shiftKey && event.key === 'F10')
            ) {
              event.preventDefault()
              void showHistory()
            }
          }}
          onClick={(event) => {
            cancel()
            if (held.current && event.detail !== 0) {
              held.current = false
              return
            }
            held.current = false
            navigate()
          }}
        >
          {direction === 'back' ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
        </IconButton>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          role="menu"
          aria-label={`${label} history`}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button[role="menuitem"]:not(:disabled)',
              ),
            ]
            if (!items.length) return
            event.preventDefault()
            const current = items.findIndex((item) => item === document.activeElement)
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : current < 0
                    ? event.key === 'ArrowDown'
                      ? 0
                      : items.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            items[next]?.focus()
          }}
          className="studio-menu-surface z-50 max-h-[min(24rem,70dvh)] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {busy && (
            <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
              Loading history…
            </p>
          )}
          {error && (
            <p role="alert" className="px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {!busy && !error && !entries.length && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No pages available.</p>
          )}
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-accent focus:bg-accent focus:outline-none"
              title={entry.url}
              onClick={() => {
                setBusy(true)
                void jump(entry)
                  .then(
                    () => setOpen(false),
                    (cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                  )
                  .finally(() => setBusy(false))
              }}
              disabled={busy}
            >
              <span className="block truncate text-sm">{entry.title || entry.url}</span>
              <span className="block truncate text-xs text-muted-foreground">{entry.url}</span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
