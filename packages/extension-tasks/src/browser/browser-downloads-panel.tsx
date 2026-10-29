import { Effect } from 'effect'
import { useEffect, useState } from 'react'
import { Download, FolderOpen } from 'lucide-react'
import { useStudioHost, startPolling } from '@dovo/studio-core'
import type { BrowserCommand, BrowserDownloadItem } from '@dovo/protocol'
import {
  Button,
  IconButton,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'

type Operation = Extract<BrowserCommand, { action: 'downloads' }>['operation']
const bytes = (value: number) =>
  value < 1024
    ? `${Math.max(0, value)} B`
    : value < 1024 * 1024
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024 / 1024).toFixed(1)} MB`
export function BrowserDownloadsPanel({
  profileId,
  tabKey,
}: {
  profileId: string
  tabKey: string
}) {
  const { browser } = useStudioHost()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<BrowserDownloadItem[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | 'folder' | null>(null)
  useEffect(() => {
    if (!open || !browser) return
    let disposed = false
    setItems([])
    setError('')
    const polling = startPolling(
      Effect.tryPromise({
        try: async () => {
          const result = await browser({
            action: 'downloads',
            key: tabKey,
            profileId,
            operation: 'list',
          })
          if (!disposed) setItems(result?.downloads ?? [])
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
      {
        interval: 700,
        onError: (cause) => {
          if (!disposed) setError(cause.message)
        },
      },
    )
    return () => {
      disposed = true
      void polling.stop()
    }
  }, [browser, profileId, tabKey, open])
  const act = async (operation: Operation, id?: number) => {
    if (!browser || busy !== null) return
    setBusy(id ?? 'folder')
    setError('')
    try {
      const result = await browser({
        action: 'downloads',
        key: tabKey,
        profileId,
        operation,
        ...(id === undefined ? {} : { id }),
      })
      if (result?.downloads) setItems(result.downloads)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <IconButton
        type="button"
        label="Downloads"
        className="size-8 shrink-0"
        onClick={() => setOpen(true)}
      >
        <Download size={15} />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>Downloads</DialogTitle>
          <DialogDescription>Files downloaded with this browser profile.</DialogDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void act('folder')}
          >
            <FolderOpen size={14} /> Open Downloads folder
          </Button>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {!items.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">No downloads yet</p>
          )}
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="space-y-2 rounded-lg border p-3">
                <p className="truncate text-sm font-medium" title={item.filename}>
                  {item.filename.split(/[\\/]/).at(-1) || 'Downloading…'}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={item.url}>
                  {item.url}
                </p>
                {item.state === 'in_progress' && (
                  <progress
                    className="h-1.5 w-full"
                    aria-label={`Download progress ${item.id}`}
                    value={item.totalBytes > 0 ? item.bytesReceived : undefined}
                    max={item.totalBytes > 0 ? item.totalBytes : undefined}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {item.state === 'complete'
                    ? item.exists
                      ? 'Complete'
                      : 'File moved or removed'
                    : item.state === 'interrupted'
                      ? item.error === 'USER_CANCELED'
                        ? 'Canceled'
                        : 'Interrupted'
                      : item.paused
                        ? 'Paused'
                        : 'Downloading'}{' '}
                  · {bytes(item.bytesReceived)}
                  {item.totalBytes > 0 ? ` / ${bytes(item.totalBytes)}` : ''}
                </p>
                <div className="flex flex-wrap gap-1">
                  {(item.state === 'in_progress'
                    ? ([item.paused ? 'resume' : 'pause', 'cancel'] as const)
                    : item.state === 'interrupted'
                      ? (['retry'] as const)
                      : item.exists
                        ? (['open', 'reveal'] as const)
                        : []
                  ).map((operation) => (
                    <Button
                      key={operation}
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null || (operation === 'resume' && !item.canResume)}
                      onClick={() => void act(operation, item.id)}
                    >
                      {
                        {
                          pause: 'Pause',
                          resume: 'Resume',
                          cancel: 'Cancel',
                          retry: 'Retry',
                          open: 'Open',
                          reveal: 'Show in folder',
                        }[operation]
                      }
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
