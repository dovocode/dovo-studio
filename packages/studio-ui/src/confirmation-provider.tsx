import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ConfirmationContext,
  type ConfirmationOptions,
  type RequestConfirmation,
} from '@dovo/studio-core'
import { Button } from './components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'

interface PendingConfirmation {
  id: number
  options: ConfirmationOptions
  returnFocus: HTMLElement | null
}

export function StudioConfirmationProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<PendingConfirmation[]>([])
  const sequence = useRef(0)
  const mounted = useRef(true)
  const pending = useRef(
    new Map<number, { resolve: (value: boolean) => void; cleanup: () => void }>(),
  )
  const settle = useCallback((id: number, accepted: boolean) => {
    const request = pending.current.get(id)
    if (!request) return
    pending.current.delete(id)
    request.cleanup()
    setRequests((current) => current.filter((item) => item.id !== id))
    request.resolve(accepted)
  }, [])
  const request = useCallback<RequestConfirmation>(
    (options, signal) => {
      if (!mounted.current || signal.aborted) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        const id = ++sequence.current
        const abort = () => settle(id, false)
        pending.current.set(id, {
          resolve,
          cleanup: () => signal.removeEventListener('abort', abort),
        })
        signal.addEventListener('abort', abort, { once: true })
        const returnFocus =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
        setRequests((current) => [
          ...current,
          {
            id,
            options,
            returnFocus,
          },
        ])
      })
    },
    [settle],
  )
  useEffect(() => {
    mounted.current = true
    const entries = pending.current
    setRequests((current) => current.filter((item) => entries.has(item.id)))
    return () => {
      mounted.current = false
      for (const request of entries.values()) {
        request.cleanup()
        request.resolve(false)
      }
      entries.clear()
    }
  }, [])
  const first = requests[0]
  return (
    <ConfirmationContext.Provider value={request}>
      {children}
      {first && <ConfirmationDialog key={first.id} request={first} onResolve={settle} />}
    </ConfirmationContext.Provider>
  )
}

function ConfirmationDialog({
  request: { id, options, returnFocus },
  onResolve,
}: {
  request: PendingConfirmation
  onResolve: (id: number, accepted: boolean) => void
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onResolve(id, false)
      }}
    >
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancel.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocus?.isConnected) returnFocus.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{options.title}</DialogTitle>
          <DialogDescription>{options.description}</DialogDescription>
        </DialogHeader>
        {options.details && (
          <pre
            role="region"
            aria-label="Details"
            tabIndex={0}
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs"
          >
            {options.details}
          </pre>
        )}
        <DialogFooter>
          <Button ref={cancel} variant="outline" onClick={() => onResolve(id, false)}>
            Cancel
          </Button>
          <Button
            variant={options.destructive ? 'destructive' : 'default'}
            onClick={() => onResolve(id, true)}
          >
            {options.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
