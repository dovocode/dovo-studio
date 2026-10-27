import { useEffect, useState } from 'react'
import { previewUrl, randomUUID, runtimeComputerName, type RuntimeProfile } from '@dovo/protocol'
import {
  useAppPreferences,
  updateAppPreferences,
  useStudioHost,
  useWorkspace,
  useRemoteBrowserProfiles,
} from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

function RemoteProfiles({
  profile,
  name,
  busy,
  choose,
}: {
  profile: RuntimeProfile
  name: string
  busy: boolean
  choose: (profileId: string, runtimeId: string) => void
}) {
  const catalog = useRemoteBrowserProfiles(profile)
  return (
    <section className="min-w-0 space-y-2">
      <h3 className="break-words text-xs font-medium text-muted-foreground">
        Remote browser · {name}
      </h3>
      {catalog.profiles?.map((item) => (
        <Button
          key={item.id}
          variant="outline"
          className="w-full min-w-0 justify-start"
          disabled={busy || !catalog.connected || !!catalog.error}
          onClick={() => choose(item.id, profile.id)}
        >
          <span className="truncate">
            {item.name} · {name}
          </span>
        </Button>
      ))}
      {catalog.loading && (
        <p role="status" className="text-xs">
          Loading profiles…
        </p>
      )}
      {catalog.error && (
        <>
          <p role="alert" className="text-xs text-destructive">
            {catalog.error}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void catalog.refresh()}
          >
            Retry profiles on {name}
          </Button>
        </>
      )}
    </section>
  )
}

/** OS links queue independently of in-app links and each selection creates its own tab. */
export function ExternalBrowserLinkChooser({
  subscribe,
  onOpen,
}: {
  subscribe: (listener: (url: string) => void) => () => void
  onOpen: () => void
}) {
  const { browser } = useStudioHost()
  const { runtimes, localRuntimeId } = useWorkspace()
  const { browserProfiles } = useAppPreferences()
  const [links, setLinks] = useState<{ id: string; url: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(
    () =>
      subscribe((url) =>
        setLinks((previous) => [...previous, { id: randomUUID(), url: previewUrl(url) }]),
      ),
    [subscribe],
  )
  const link = links[0]
  if (!link || !browser) return null
  const dismiss = () => {
    if (busy) return
    setLinks((previous) => previous.filter((item) => item.id !== link.id))
    setError('')
  }
  const choose = async (profileId: string, runtimeId?: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (
        runtimeId &&
        !runtimes.some((runtime) => runtime.profile.id === runtimeId && runtime.connected)
      )
        throw new Error('Reconnect to this computer before opening the link.')
      await browser({
        action: 'open-tab',
        key: `external:${link.id}`,
        tab: {
          id: link.id,
          url: link.url,
          title: '',
          kind: runtimeId ? 'remote' : 'web',
          profileId,
          runtimeId: runtimeId ?? localRuntimeId ?? undefined,
          visitedAt: Date.now(),
        },
      })
      updateAppPreferences({ browserWorkspaceEnabled: true })
      onOpen()
      setLinks((previous) => previous.filter((item) => item.id !== link.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent className="max-h-[85dvh] max-w-md overflow-y-auto">
        <DialogTitle>Open external link</DialogTitle>
        <DialogDescription className="break-all text-xs">{link.url}</DialogDescription>
        <section className="min-w-0 space-y-2">
          <h3 className="break-words text-xs font-medium text-muted-foreground">
            On this computer
          </h3>
          {(browserProfiles.length ? browserProfiles : [{ id: 'default', name: 'Default' }]).map(
            (profile) => (
              <Button
                key={profile.id}
                variant="outline"
                className="w-full min-w-0 justify-start"
                disabled={busy}
                onClick={() => void choose(profile.id)}
              >
                <span className="truncate">{profile.name} · This computer</span>
              </Button>
            ),
          )}
        </section>
        {runtimes
          .filter((runtime) => runtime.connected)
          .map((runtime) => (
            <RemoteProfiles
              key={runtime.profile.id}
              profile={runtime.profile}
              name={runtimeComputerName(runtime)}
              busy={busy}
              choose={(profileId, runtimeId) => void choose(profileId, runtimeId)}
            />
          ))}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {links.length > 1 && (
          <p role="status" className="text-xs text-muted-foreground">
            {links.length} links waiting
          </p>
        )}
        <Button variant="ghost" disabled={busy} onClick={dismiss}>
          Cancel this link
        </Button>
      </DialogContent>
    </Dialog>
  )
}
