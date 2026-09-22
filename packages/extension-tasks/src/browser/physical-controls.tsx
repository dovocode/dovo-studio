import { useEffect, useState } from 'react'
import {
  useWorkspace,
  previewResultSchema,
  previewUrl,
  type PreviewDevice,
} from '@dovo/studio-core'
import { SlidersHorizontal } from 'lucide-react'
import { Button, Input, IconButton, Popover } from '@dovo/studio-ui'

export function PhysicalControls({ taskId, device }: { taskId: string; device: PreviewDevice }) {
  const { request, connection } = useWorkspace()
  const [apps, setApps] = useState<Array<{ name: string; bundleId: string }>>([])
  const [selected, setSelected] = useState(''),
    [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    void request(
      '/api/previews/action',
      { taskId, id: device.id, action: 'apps' },
      previewResultSchema,
    )
      .then((result) => {
        if (live) {
          setApps(result.apps ?? [])
          setSelected(result.apps?.[0]?.bundleId ?? '')
        }
      })
      .catch((error) => {
        if (live) setError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      live = false
    }
  }, [device.id, taskId, request])
  const act = async (action: string) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await request(
        '/api/previews/action',
        {
          taskId,
          id: device.id,
          action,
          bundleId: selected || undefined,
          url: action === 'open' ? previewUrl(url, connection?.address) : undefined,
        },
        previewResultSchema,
      )
      setMessage('Applied on ' + device.name)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <IconButton label="Device settings" className="size-7">
          <SlidersHorizontal size={15} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[70] flex max-h-[70vh] w-80 max-w-[calc(100vw-24px)] flex-col gap-3 overflow-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
        >
          <h3 className="text-sm font-medium">Device settings</h3>
          <p className="text-xs text-muted-foreground">
            Direct device connection. Tap, drag, hold, scroll, or type in the preview. No Device Hub
            window needed.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Developer app"
              className="min-w-0 max-w-full rounded-md border bg-background p-2 text-sm"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={busy}
            >
              {!apps.length && <option value="">No developer apps installed</option>}
              {apps.map((app) => (
                <option key={app.bundleId} value={app.bundleId}>
                  {app.name}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={busy || !selected} onClick={() => void act('launch')}>
              Launch
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !selected}
              onClick={() => void act('relaunch')}
            >
              Relaunch
            </Button>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void act('open')
            }}
          >
            <Input
              aria-label="Open URL on phone"
              placeholder="https:// or your Mac’s LAN address"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button size="sm" disabled={busy || !url.trim()}>
              Open URL
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {(['portrait', 'landscape', 'light', 'dark'] as const).map((action) => (
              <Button
                key={action}
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void act(action)}
              >
                {action[0].toUpperCase() + action.slice(1)}
              </Button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-xs text-muted-foreground">
              {message}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
