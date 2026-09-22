import { useRef, useState } from 'react'
import { type RepositorySource, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
} from '@dovo/studio-ui'
import { Monitor } from 'lucide-react'

// Choose an execution destination only when an action needs one, never to browse a collection.
type SourceChoice = Pick<RepositorySource, 'key' | 'runtimeId' | 'runtimeName' | 'connected'> & {
  name?: string
  repository?: { name: string }
}
const sourceName = (source: SourceChoice) => source.name ?? source.repository?.name ?? 'Source'

export function SourcePicker<T extends SourceChoice>({
  sources,
  title,
  onSelect,
  onClose,
}: {
  sources: T[]
  title: string
  onSelect: (source: T) => void
  onClose: () => void
}) {
  const { activeRuntimeId, switchRuntime } = useWorkspace()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const visibleSources = sources.filter((source) =>
    `${sourceName(source)} ${source.runtimeName}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose the source for this action.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Find a source or computer…"
          aria-label="Find project"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {visibleSources.map((source) => (
            <Button
              key={source.key}
              variant="ghost"
              className="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
              disabled={busy || !source.connected}
              onClick={() => {
                if (pending.current || !source.connected) return
                pending.current = true
                setBusy(true)
                setError('')
                void (
                  source.runtimeId === activeRuntimeId
                    ? Promise.resolve()
                    : switchRuntime(source.runtimeId)
                )
                  .then(() => onSelect(source))
                  .catch((error) => setError(String(error)))
                  .finally(() => {
                    pending.current = false
                    setBusy(false)
                  })
              }}
            >
              <Monitor className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate">{sourceName(source)}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {source.runtimeName}
                  {!source.connected ? ' · Offline' : ''}
                </span>
              </span>
            </Button>
          ))}
        </div>
        {!!sources.length && !visibleSources.length && (
          <p className="text-sm text-muted-foreground">No matching sources.</p>
        )}
        {!sources.length && (
          <p className="text-sm text-muted-foreground">
            Connect an issue source or add a project to get started.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
