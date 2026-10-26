import { useRef, useState } from 'react'
import { Puzzle, Plus, Settings2, ExternalLink } from 'lucide-react'
import type { BrowserExtensionCommand, BrowserExtensionsResult } from '@dovo/protocol'
import { useStudioHost } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  DropdownMenu,
} from '@dovo/studio-ui'

export function BrowserExtensions({
  profileId,
  tabKey,
  hasPage,
  profileName = 'Default',
  pageUrl = '',
  onBrowseStore,
}: {
  profileId: string
  tabKey: string
  hasPage: boolean
  profileName?: string
  pageUrl?: string
  onBrowseStore?: () => void
}) {
  const { browserExtensions } = useStudioHost()
  const trigger = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const storePage = chromeWebStorePage(pageUrl)
  const [storeUrl, setStoreUrl] = useState('')
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
  const launch = (id: string) => {
    const bounds = trigger.current?.getBoundingClientRect()
    if (!bounds) return
    // Let the DOM menu close and its focus restoration finish before opening a native popup.
    requestAnimationFrame(() => {
      void call({
        action: 'open',
        profileId,
        id,
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
    })
  }
  if (!browserExtensions) return null
  return (
    <>
      {storePage && (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          className="shrink-0 gap-1.5"
          onClick={() => {
            setOpen(true)
            void call({ action: 'installStore', profileId, url: storePage })
          }}
        >
          <Plus size={14} />
          Add to Dovo
        </Button>
      )}
      <DropdownMenu.Root
        open={menuOpen}
        onOpenChange={(value) => {
          setMenuOpen(value)
          if (value) void call({ action: 'list', profileId })
        }}
      >
        <DropdownMenu.Trigger asChild>
          <IconButton ref={trigger} label="Extensions" type="button" className="size-8 shrink-0">
            <Puzzle size={15} />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-50 w-72 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
            }}
          >
            <div className="px-2 py-2">
              <p className="text-sm font-medium">Extensions</p>
              <p className="text-xs text-muted-foreground">{profileName}</p>
            </div>
            {error && (
              <p role="alert" className="px-2 py-1 text-xs text-destructive">
                {error}
              </p>
            )}
            {!result && (
              <p className="px-2 py-2 text-xs text-muted-foreground">Loading extensions…</p>
            )}
            {result && !result.extensions.length && (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                No extensions in this profile.
              </p>
            )}
            {result?.extensions.map((extension) => (
              <DropdownMenu.Item
                key={extension.id}
                disabled={busy || !extension.loaded || !hasPage}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50"
                onSelect={() => {
                  setMenuOpen(false)
                  launch(extension.id)
                }}
              >
                {extension.icon ? (
                  <img src={extension.icon} alt="" className="size-5 shrink-0 object-contain" />
                ) : (
                  <Puzzle size={18} className="shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{extension.name}</span>
                {!extension.enabled && <span className="text-xs text-muted-foreground">Off</span>}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            {onBrowseStore && (
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent"
                onSelect={onBrowseStore}
              >
                <ExternalLink size={14} />
                Chrome Web Store
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none focus:bg-accent"
              onSelect={() => {
                setRemoveId('')
                setOpen(true)
              }}
            >
              <Settings2 size={14} />
              Manage extensions
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
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
            Installed in {profileName}. Permissions and website access apply only to this profile.
          </DialogDescription>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto" aria-busy={busy}>
            <p className="text-sm text-muted-foreground">
              Paste a Chrome Web Store link or load an extension folder. Review its access before
              installing in this profile. Desktop app connections require your approval. Store
              extensions update when you install their link again.
            </p>
            {result?.capabilities.chromeWebStore && (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void call({ action: 'installStore', profileId, url: storeUrl.trim() })
                }}
              >
                <Input
                  aria-label="Chrome Web Store URL or extension ID"
                  placeholder="Chrome Web Store URL or extension ID"
                  value={storeUrl}
                  onChange={(event) => setStoreUrl(event.target.value)}
                  disabled={busy}
                  maxLength={4096}
                  className="min-w-0 flex-1"
                />
                <Button type="submit" disabled={busy || !storeUrl.trim()}>
                  Install from Web Store
                </Button>
              </form>
            )}
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
                    Previously removed access: {extension.removedPermissions.join(', ')}. Reinstall
                    from the store to review and enable it.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !extension.loaded || !hasPage}
                    onClick={() => {
                      setOpen(false)
                      launch(extension.id)
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

export function chromeWebStorePage(value: string) {
  try {
    const url = new URL(value)
    if (
      url.protocol === 'https:' &&
      url.hostname === 'chromewebstore.google.com' &&
      !url.username &&
      !url.password &&
      /^\/detail\/(?:[^/]+\/)?[a-p]{32}\/?$/.test(url.pathname)
    )
      return url.href
  } catch {
    /* Ordinary pages do not offer an extension install. */
  }
  return undefined
}
