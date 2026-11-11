import { Suspense, useState, type ComponentType } from 'react'
import type { StudioViewProps } from '@dovo/studio-core'
import { encodeWorkTarget } from '@dovo/protocol'
import type { LinkTarget } from '@dovo/studio-core/links'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ErrorBoundary,
} from '@dovo/studio-ui'
import { ArrowUpRight, ExternalLink } from 'lucide-react'

export function PipelineLinkDialog({
  target,
  View,
  onClose,
  onDetails,
  onExternal,
}: {
  target: LinkTarget
  View?: ComponentType<StudioViewProps>
  onClose: () => void
  onDetails: () => void
  onExternal?: (url: string) => Promise<void>
}) {
  const [error, setError] = useState('')
  if (target.kind !== 'pipeline') return null
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex h-[85dvh] max-h-[900px] w-[calc(100vw-24px)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <DialogTitle>Pipeline preview</DialogTitle>
          <DialogDescription className="truncate">{target.label}</DialogDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={onDetails}>
              <ArrowUpRight className="size-3.5" />
              Open details
            </Button>
            <a
              data-dovo-external
              href={target.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs underline underline-offset-4"
              onClick={
                onExternal
                  ? (event) => {
                      event.preventDefault()
                      void onExternal(target.url).catch((cause: unknown) => setError(String(cause)))
                    }
                  : undefined
              }
            >
              <ExternalLink className="size-3.5" />
              Open URL
            </a>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <ErrorBoundary>
            <Suspense
              fallback={
                <p role="status" className="p-5 text-sm text-muted-foreground">
                  Loading pipeline…
                </p>
              }
            >
              {View ? (
                <View
                  entityId={encodeWorkTarget({
                    runtimeId: target.runtimeId,
                    repositoryId: target.repositoryId,
                    id: target.itemId,
                    url: target.url,
                  })}
                  preview
                  onClose={onClose}
                />
              ) : (
                <p role="status" className="p-5 text-sm">
                  The pipeline viewer is unavailable. Open the URL to view this run.
                </p>
              )}
            </Suspense>
          </ErrorBoundary>
        </div>
      </DialogContent>
    </Dialog>
  )
}
