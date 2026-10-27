import { useRef, useState } from 'react'
import { SlidersHorizontal, LockKeyhole, Globe2, Mic, Camera, Bell } from 'lucide-react'
import { useStudioHost } from '@dovo/studio-core'
import { Button, IconButton, Popover } from '@dovo/studio-ui'
import type { BrowserCommand, BrowserSitePermissions } from '@dovo/protocol'

const controls = [
  { permission: 'notifications', label: 'Notifications', Icon: Bell },
  { permission: 'microphone', label: 'Microphone', Icon: Mic },
  { permission: 'camera', label: 'Camera', Icon: Camera },
] as const

/** Every command is resolved against the native page's current origin and profile. */
export function BrowserSiteControls({
  tabKey,
  url,
  profileName,
}: {
  tabKey: string
  url: string
  profileName: string
}) {
  const { browser } = useStudioHost()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<BrowserSitePermissions>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const pending = useRef(false)
  let page: URL | undefined
  try {
    const parsed = new URL(url)
    if (/^https?:$/.test(parsed.protocol)) page = parsed
  } catch {
    /* New tabs have no origin. */
  }
  const call = async (command: BrowserCommand) => {
    if (!browser || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await browser(command)
      if (result?.sitePermissions) setState(result.sitePermissions)
      else
        throw new Error('Website controls are unavailable. Update the desktop app and try again.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setOpen(true)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        setConfirmClear(false)
        if (value) void call({ action: 'site-permissions', key: tabKey })
      }}
    >
      <Popover.Trigger asChild>
        <IconButton
          type="button"
          label="Website permissions and site data"
          disabled={!browser || !page}
          className="size-8 shrink-0 rounded-full"
        >
          <SlidersHorizontal size={15} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          aria-label="Website permissions"
          className="z-50 w-80 max-w-[calc(100vw-1rem)] space-y-4 rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          <div>
            <h2 className="truncate text-sm font-medium">{page?.host}</h2>
            <p className="text-xs text-muted-foreground">{profileName}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {page?.protocol === 'https:' ? <LockKeyhole size={14} /> : <Globe2 size={14} />}
            {page?.protocol === 'https:' ? 'Connection is encrypted' : 'HTTP connection'}
          </div>
          <div className="space-y-3" aria-busy={busy}>
            {controls.map(({ permission, label, Icon }) => (
              <div key={permission} className="flex items-center gap-2">
                <Icon size={15} className="shrink-0 text-muted-foreground" />
                <label htmlFor={`${tabKey}-${permission}`} className="flex-1 text-sm">
                  {label}
                </label>
                <select
                  id={`${tabKey}-${permission}`}
                  aria-label={`${label} permission`}
                  className="min-w-0 rounded border bg-background px-1.5 py-1 text-xs"
                  disabled={busy || !state || !page}
                  value={state?.permissions[permission] ?? 'ask'}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === 'ask' || value === 'allow' || value === 'block')
                      void call({
                        action: 'set-site-permission',
                        origin: page!.origin,
                        key: tabKey,
                        permission,
                        setting: value,
                      })
                  }}
                >
                  <option value="ask">Ask every time</option>
                  <option value="allow">Allow</option>
                  <option value="block">Block</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy || !state || !page}
                  aria-label={`Request ${label.toLowerCase()} permission`}
                  onClick={() => {
                    setOpen(false)
                    void call({
                      action: 'request-site-permission',
                      origin: page!.origin,
                      key: tabKey,
                      permission,
                    })
                  }}
                >
                  Ask
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Saved for this website in {profileName}. Ask opens a new permission prompt. Changes
            apply to future requests; reload to stop existing access.
          </p>
          <div className="border-t pt-3">
            {confirmClear ? (
              <div className="space-y-2">
                <p className="text-xs">Clear cookies and site data? This may sign you out.</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void call({ action: 'clear-site-data', key: tabKey, origin: page!.origin })
                      setConfirmClear(false)
                    }}
                  >
                    Clear site data
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmClear(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmClear(true)}
              >
                Cookies and site data…
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
