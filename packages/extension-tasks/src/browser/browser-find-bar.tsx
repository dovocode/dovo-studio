import { useEffect, useRef, useState, useEffectEvent } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { IconButton, Input, Button } from '@dovo/studio-ui'
import type { BrowserBridge, BrowserFindResult } from '@dovo/protocol'

export function BrowserFindBar({
  browser,
  browserKey,
  url,
  open,
  onOpenChange,
  globalShortcut,
  focusRequest,
  pageRevision,
}: {
  browser: BrowserBridge
  browserKey: string
  url: string
  globalShortcut: boolean
  focusRequest: number
  pageRevision: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [regex, setRegex] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [result, setResult] = useState<BrowserFindResult>({ active: 0, total: 0 })
  const version = useRef(0)
  const search = useEffectEvent(async (direction?: 'next' | 'previous') => {
    const revision = ++version.current
    try {
      const response = await browser({
        action: 'find',
        key: browserKey,
        text,
        regex,
        matchCase,
        direction,
      })
      if (revision === version.current) setResult(response?.find ?? { active: 0, total: 0 })
    } catch (error) {
      if (revision === version.current) setResult({ active: 0, total: 0, error: String(error) })
    }
  })
  const close = useEffectEvent(() => {
    version.current++
    onOpenChange(false)
    void browser({ action: 'stop-find', key: browserKey, focus: true }).catch((error: unknown) =>
      console.error('Could not close page search', error),
    )
  })
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!root.current?.parentElement?.checkVisibility({ visibilityProperty: true })) return
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="alertdialog"]')
      )
        return
      if (
        !globalShortcut &&
        event.target instanceof Node &&
        !root.current?.parentElement?.contains(event.target)
      )
        return
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault()
        event.stopPropagation()
        onOpenChange(true)
        input.current?.focus()
        input.current?.select()
      } else if (open && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', shortcut, true)
    return () => window.removeEventListener('keydown', shortcut, true)
  }, [open, onOpenChange, globalShortcut])
  useEffect(() => {
    if (open) {
      input.current?.focus()
      input.current?.select()
    }
  }, [open, focusRequest])
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      void search()
    }, 150)
    return () => {
      clearTimeout(timer)
      version.current++
    }
  }, [open, text, regex, matchCase, url, pageRevision])
  useEffect(
    () => () => {
      version.current++
      void browser({ action: 'stop-find', key: browserKey }).catch((error: unknown) =>
        console.error('Could not clear page search', error),
      )
    },
    [browser, browserKey],
  )
  return (
    <div ref={root} className="shrink-0">
      {open && (
        <div
          role="search"
          aria-label="Find on page"
          className="flex flex-wrap items-center justify-end gap-1 border-b bg-sidebar/70 px-2 py-1.5"
        >
          <Input
            ref={input}
            aria-label="Find on page"
            placeholder="Find on page"
            maxLength={1000}
            value={text}
            className="h-8 min-w-24 flex-1 text-xs sm:max-w-72"
            aria-invalid={!!result.error}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void search(event.shiftKey ? 'previous' : 'next')
              }
            }}
          />
          <Button
            type="button"
            variant={matchCase ? 'secondary' : 'ghost'}
            className="h-8 px-2 text-xs"
            aria-label="Match case"
            aria-pressed={matchCase}
            onClick={() => setMatchCase((value) => !value)}
          >
            Aa
          </Button>
          <Button
            type="button"
            variant={regex ? 'secondary' : 'ghost'}
            className="h-8 px-2 font-mono text-xs"
            aria-label="Use regular expression"
            aria-pressed={regex}
            onClick={() => setRegex((value) => !value)}
          >
            .*
          </Button>
          <span
            role="status"
            aria-live="polite"
            className="min-w-12 text-center text-xs text-muted-foreground"
          >
            {result.active}/{result.total}
            {result.limited ? '+' : ''}
          </span>
          <IconButton
            type="button"
            label="Previous match"
            className="size-8"
            disabled={!text || !!result.error}
            onClick={() => void search('previous')}
          >
            <ChevronUp size={15} />
          </IconButton>
          <IconButton
            type="button"
            label="Next match"
            className="size-8"
            disabled={!text || !!result.error}
            onClick={() => void search('next')}
          >
            <ChevronDown size={15} />
          </IconButton>
          <IconButton type="button" label="Close find" className="size-8" onClick={close}>
            <X size={15} />
          </IconButton>
          {result.error && (
            <p role="alert" className="w-full text-xs text-destructive">
              {result.error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
