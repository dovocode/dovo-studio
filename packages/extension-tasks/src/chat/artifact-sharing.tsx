import { useAppPreferences } from '@dovo/studio-core'
import { useEffect, useState } from 'react'
import type { AccountStorage, Artifact } from '@dovo/protocol'
import { ArtifactFeedSetup } from './artifact-feed'
import { useAccount, useStudioHost } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'
import { Share2 } from 'lucide-react'
import { ArtifactSharedBadge } from './artifact-shared-badge'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'

export function ArtifactSharing({ artifact }: { artifact: Artifact }) {
  const host = useStudioHost()
  const [open, setOpen] = useState(false)
  if (!host.accountStorage || !host.openExternalLink) return null
  return (
    <>
      <ArtifactSharedBadge artifact={artifact} />
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="Share artifact">
        <Share2 className="size-3.5" /> Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogTitle>Share artifact</DialogTitle>
          <DialogDescription>
            Publish a private copy of “{artifact.title}”, version {artifact.revision}.
          </DialogDescription>
          {open && (
            <ArtifactSharingContent
              key={`${artifact.id}:${artifact.revision}`}
              artifact={artifact}
              storage={host.accountStorage}
              open={host.openExternalLink}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
function ArtifactSharingContent({
  artifact,
  storage,
  open,
}: {
  artifact: Artifact
  storage: AccountStorage
  open: (url: string) => Promise<void>
}) {
  const services = useAppPreferences()
  const account = useAccount(storage, open, services)
  const [origin, setOrigin] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const existing = account.publications?.find(
    (item) => item.sourceId === artifact.id && item.revision === artifact.revision,
  )
  const published =
    account.directory && existing && origin && origin === account.publicationOrigin
      ? {
          publicationId: existing.id,
          url: origin + '/s/' + existing.id,
          manageUrl: origin + '/manage/' + existing.id,
        }
      : undefined
  const [retry, setRetry] = useState(0)
  const sessionId = account.client.sessionId()
  useEffect(() => {
    let disposed = false
    setError('')
    setOrigin('')
    void account.client.refreshPublications()
    void account.client
      .artifactService()
      .then((value) => {
        if (!disposed) setOrigin(value)
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Sharing unavailable')
      })
    return () => {
      disposed = true
    }
  }, [account.client, retry, account.directory?.user.id])
  const publish = async () => {
    setBusy(true)
    setError('')
    try {
      await account.client.publishArtifact(artifact, origin)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publication failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 text-sm">
      {origin && (
        <p>
          Destination: <span className="break-all font-medium">{origin}</span>
        </p>
      )}
      <p className="text-muted-foreground">
        The saved content and all included source files will be uploaded. Review them for secrets
        before publishing. The hosted copy remains available independently of this computer and its
        local retention settings.
      </p>
      <p className="text-muted-foreground">
        Only you can open it initially. Invite accounts or explicitly create expiring shareable
        links in sharing settings.
      </p>
      {!account.loaded ? (
        <p>Loading account…</p>
      ) : !account.directory ? (
        <>
          <Button disabled={account.busy || !origin} onClick={() => void account.client.signIn()}>
            Sign in to publish
          </Button>
          {account.login && (
            <p>
              Compare sign-in code: <strong>{account.login.code}</strong>
            </p>
          )}
          {account.login && (
            <Button variant="outline" onClick={() => account.client.cancel()}>
              Cancel sign-in
            </Button>
          )}
        </>
      ) : (
        <>
          <p>
            Publishing as <strong>{account.directory.user.name}</strong>
            {account.directory.user.organization
              ? ` (${account.directory.user.organization.name})`
              : ''}
            .
          </p>
          {!published && (
            <Button
              disabled={!origin || busy || account.busy || account.deletionPending}
              onClick={() => void publish()}
            >
              {busy ? 'Publishing…' : 'Publish private copy'}
            </Button>
          )}
        </>
      )}
      {published && (
        <div className="space-y-2" role="status">
          <p>
            Shared · Version {artifact.revision}. Hosted access is managed separately from this
            local copy.
          </p>
          <Button
            onClick={() =>
              void account.client
                .artifactManagementUrl(published.publicationId, origin)
                .then(open)
                .catch((cause: unknown) => setError(String(cause)))
            }
          >
            Manage invitations and links
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void copyTextToClipboard(published.url).catch((cause) => setError(String(cause)))
            }
          >
            Copy private link
          </Button>
        </div>
      )}
      {published && (
        <ArtifactFeedSetup
          key={sessionId}
          artifact={artifact}
          publicationId={published.publicationId}
          origin={origin}
          client={account.client}
        />
      )}
      {(error || account.error) && (
        <p role="alert" className="text-destructive">
          {error || account.error}
        </p>
      )}
      {account.directory && account.publicationError && !error && (
        <p role="status" className="text-xs text-muted-foreground">
          {account.publicationError}
        </p>
      )}
      {error && !origin && (
        <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
          Retry sharing service
        </Button>
      )}
    </div>
  )
}
