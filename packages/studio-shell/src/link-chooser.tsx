import { useCallback, useEffect, useRef } from 'react'
import {
  linkActions,
  useLinkController,
  type LinkOptions,
  type LinkOrigin,
  type LinkTarget,
} from '@dovo/studio-core/links'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'
import { Copy, ExternalLink, GitPullRequest, Globe } from 'lucide-react'

type Adapters = {
  origin: () => LinkOrigin
  targets: (url: string, origin: LinkOrigin) => LinkTarget[]
  details: (target: LinkTarget) => unknown
  browser?: (url: string) => unknown
  external: (url: string) => unknown
  onError: (error: unknown) => void
}
export function useLinkChooser(adapters: Adapters) {
  const latest = useRef(adapters)
  latest.current = adapters
  const { controller, pending } = useLinkController()
  const getLinkActions = useCallback((url: string, options?: LinkOptions) => {
    const host = latest.current
    const origin = { ...host.origin(), ...options?.origin }
    return linkActions(
      url,
      host.targets(url, origin),
      {
        details: (target) => options?.details?.(target) || host.details(target),
        browser: options?.browser ?? host.browser,
        external: host.external,
        copy: (url) => navigator.clipboard.writeText(url),
      },
      options?.actions,
    )
  }, [])
  const openLink = useCallback(
    (url: string, options?: LinkOptions) => {
      controller.open({
        url,
        signal: options?.signal,
        onError: latest.current.onError,
        actions: getLinkActions(url, options),
      })
    },
    [controller, getLinkActions],
  )
  const cancel = useCallback(() => controller.cancel(), [controller])
  useEffect(() => {
    if (pending?.closing) controller.dismissed(pending.request)
  }, [pending, controller])
  return {
    openLink,
    cancel,
    getLinkActions,
    dialog: pending && (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) controller.dismissed(pending.request)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogTitle>Open link</DialogTitle>
          <DialogDescription className="break-all text-xs">{pending.request.url}</DialogDescription>
          {pending.request.actions.map((action) => (
            <Button
              key={action.id}
              variant="outline"
              className="justify-start"
              disabled={pending.busy || action.disabled}
              onClick={() =>
                controller.select(pending.request, action.id, () =>
                  controller.dismissed(pending.request),
                )
              }
            >
              {action.kind === 'browser' ? (
                <Globe className="size-4" />
              ) : action.kind === 'copy' ? (
                <Copy className="size-4" />
              ) : action.kind === 'details' ? (
                <GitPullRequest className="size-4" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              {action.label}
            </Button>
          ))}
          {pending.error && (
            <p role="alert" className="text-xs text-destructive">
              {pending.error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    ),
  }
}
