import { useRef, useState } from 'react'
import { Puzzle } from 'lucide-react'
import type { BrowserExtensionCommand, BrowserExtensionsResult } from '@dovo/protocol'
import { useStudioHost } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
} from '@dovo/studio-ui'

export function BrowserExtensions({
  profileId,
  tabKey,
  hasPage,
}: {
  profileId: string
  tabKey: string
  hasPage: boolean
}) {
  const { browserExtensions } = useStudioHost()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<BrowserExtensionsResult>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removeId, setRemoveId] = useState('')
  const pending = useRef(false)
  const generation = useRef(0)
  const call = async (command: BrowserExtensionCommand) => {
    if (!browserExtensions || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    const attempt = generation.current
    try {
      const next = await browserExtensions(command)
      if (attempt !== generation.current) return
      if (next) setResult(next)
      return true
    } catch (cause) {
      if (attempt === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      pending.current = false
      if (attempt === generation.current) setBusy(false)
    }
  }
  if (!browserExtensions) return null
  return (
    <>
      <IconButton
        label="Extensions"
        type="button"
        className="size-8 shrink-0"
        onClick={() => {
          setResult(undefined)
          setRemoveId('')
          setOpen(true)
          void call({ action: 'list', profileId })
        }}
      >
        <Puzzle size={15} />
      </IconButton>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (busy) return
          generation.current++
          setOpen(value)
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogTitle>Browser extensions</DialogTitle>
          <DialogDescription>
            Experimental · Installed in this local browser profile. Chrome API compatibility varies
            by extension.
          </DialogDescription>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto" aria-busy={busy}>
            <p className="text-sm text-muted-foreground">
              Load an unpacked extension folder from this computer. The installer shows its
              requested access before adding it. Native messaging and Chrome Web Store installation
              are unavailable.
            </p>
            <Button disabled={busy} onClick={() => void call({ action: 'install', profileId })}>
              Load extension folder…
            </Button>
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                Updating extensions…
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {result?.extensions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No extensions installed in this profile.
              </p>
            )}
            {result?.extensions.map((extension) => (
              <div key={extension.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  {extension.icon ? (
                    <img src={extension.icon} alt="" className="size-6" />
                  ) : (
                    <Puzzle size={20} aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{extension.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {extension.version} ·{' '}
                      {extension.loaded
                        ? 'Enabled'
                        : extension.enabled
                          ? 'Could not load'
                          : 'Disabled'}
                    </p>
                  </div>
                </div>
                {extension.error && (
                  <p role="alert" className="text-xs text-destructive">
                    {extension.error}
                  </p>
                )}
                {!!extension.unsupportedPermissions.length && (
                  <p className="text-xs text-muted-foreground">
                    Unsupported access: {extension.unsupportedPermissions.join(', ')}. Features
                    requiring it may not work.
                  </p>
                )}
                {!!extension.removedPermissions.length && (
                  <p className="text-xs text-muted-foreground">
                    Blocked access: {extension.removedPermissions.join(', ')}.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !extension.loaded || !hasPage}
                    onClick={(event) => {
                      const bounds = event.currentTarget.getBoundingClientRect()
                      setOpen(false)
                      void call({
                        action: 'open',
                        profileId,
                        id: extension.id,
                        key: tabKey,
                        anchor: {
                          x: Math.max(0, Math.round(bounds.x)),
                          y: Math.max(0, Math.round(bounds.y)),
                          width: Math.max(1, Math.round(bounds.width)),
                          height: Math.max(1, Math.round(bounds.height)),
                        },
                      }).then((succeeded) => {
                        if (!succeeded) setOpen(true)
                      })
                    }}
                  >
                    {extension.popup ? 'Open popup' : 'Run action'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void call({
                        action: extension.enabled ? 'disable' : 'enable',
                        profileId,
                        id: extension.id,
                      })
                    }
                  >
                    {extension.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setRemoveId(extension.id)}
                  >
                    Remove…
                  </Button>
                </div>
                {removeId === extension.id && (
                  <div className="space-y-2 text-sm">
                    <p>Remove {extension.name} from this profile?</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void call({ action: 'remove', profileId, id: extension.id }).then(() =>
                            setRemoveId(''),
                          )
                        }
                      >
                        Remove extension
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setRemoveId('')}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
