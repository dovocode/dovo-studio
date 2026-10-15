import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioHostApi } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'
import { ExternalLink, GitPullRequest, Globe, Workflow } from 'lucide-react'

type ChooseLink = NonNullable<StudioHostApi['chooseLink']>
type Destination = Awaited<ReturnType<ChooseLink>>
export function useLinkChooser() {
  const [pending, setPending] = useState<{
    url: string
    options: Parameters<ChooseLink>[1]
  } | null>(null)
  const resolve = useRef<((choice: Destination) => void) | undefined>(undefined)
  const finish = useCallback((choice: Destination) => {
    const done = resolve.current
    resolve.current = undefined
    setPending(null)
    done?.(choice)
  }, [])
  useEffect(() => () => resolve.current?.('cancel'), [])
  useEffect(() => {
    const signal = pending?.options?.signal
    if (!signal) return
    const cancel = () => finish('cancel')
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
    return () => signal.removeEventListener('abort', cancel)
  }, [pending, finish])
  const chooseLink = useCallback<ChooseLink>(
    (url, options) =>
      new Promise((done) => {
        resolve.current?.('cancel')
        resolve.current = done
        setPending({ url, options })
      }),
    [],
  )
  return {
    chooseLink,
    dialog: pending && (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) finish('cancel')
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogTitle>Open link</DialogTitle>
          <DialogDescription className="break-all text-xs">{pending.url}</DialogDescription>
          {pending.options?.details && (
            <Button variant="outline" className="justify-start" onClick={() => finish('details')}>
              {pending.options.details === 'pull' ? (
                <GitPullRequest className="size-4" />
              ) : (
                <Workflow className="size-4" />
              )}
              {pending.options.details === 'pull' ? 'Open PR details' : 'Open pipeline details'}
            </Button>
          )}
          {pending.options?.browser !== false && (
            <Button variant="outline" className="justify-start" onClick={() => finish('browser')}>
              <Globe className="size-4" />
              Open in Dovo browser
            </Button>
          )}
          <Button variant="outline" className="justify-start" onClick={() => finish('external')}>
            <ExternalLink className="size-4" />
            Open in external browser
          </Button>
        </DialogContent>
      </Dialog>
    ),
  }
}
