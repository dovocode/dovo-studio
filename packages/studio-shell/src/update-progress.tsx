import type { DesktopUpdateState } from '@dovo/protocol'
import { LoaderCircle } from 'lucide-react'

const size = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export function UpdateProgress({ state }: { state?: DesktopUpdateState | null }) {
  if (state?.status === 'downloading') {
    const progress = Math.min(100, Math.max(0, state.progress ?? 0))
    return (
      <div className="mt-4 text-xs" role="status" aria-live="polite">
        <div className="flex justify-between gap-2">
          <span>Downloading {Math.round(progress)}%</span>
          {!!state.total && (
            <span>
              {size(state.transferred ?? 0)} / {size(state.total)}
            </span>
          )}
        </div>
        <div
          role="progressbar"
          aria-label="Update download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
        {!!state.bytesPerSecond && (
          <p className="mt-1 text-muted-foreground">{size(state.bytesPerSecond)}/s</p>
        )}
        <p className="mt-2 text-muted-foreground">
          You can keep working. Dovo will ask before closing to install the update.
        </p>
      </div>
    )
  }
  if (state?.status === 'downloaded')
    return (
      <p className="mt-4 text-xs" role="status">
        Ready to install. Dovo will close during installation. Your projects and conversations are
        kept.
      </p>
    )
  if (state?.status === 'restarting')
    return (
      <div className="mt-4 text-xs" role="status">
        <p className="flex items-center gap-2">
          <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
          Closing Dovo to install the update…
        </p>
        <p className="mt-2 text-muted-foreground">
          Installation will continue after this window closes.
        </p>
      </div>
    )
  return null
}
