import { useState } from 'react'
import { useAccount, useAppPreferences, useStudioHost } from '@dovo/studio-core'
import { artifactPublicationInput, type Artifact, type AccountStorage } from '@dovo/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'
import { Share2 } from 'lucide-react'
import { ArtifactFeedSetup } from './artifact-feed'
import { SharingPanel } from './sharing-panel'

export function ArtifactSharing({ artifact }: { artifact: Artifact }) {
  const host = useStudioHost()
  if (!host.accountStorage || !host.openExternalLink) return null
  return (
    <SignedInArtifactSharing
      artifact={artifact}
      storage={host.accountStorage}
      openUrl={host.openExternalLink}
    />
  )
}
function SignedInArtifactSharing({
  artifact,
  storage,
  openUrl,
}: {
  artifact: Artifact
  storage: AccountStorage
  openUrl: (url: string) => Promise<void>
}) {
  const account = useAccount(storage, openUrl, useAppPreferences())
  const [open, setOpen] = useState(false)
  if (!account.directory || account.deletionPending) return null
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label="Share artifact">
        <Share2 className="size-3.5" />
        Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogTitle>Share artifact</DialogTitle>
          <DialogDescription>
            Manage encrypted sharing for “{artifact.title}”, version {artifact.revision}.
          </DialogDescription>
          {open && <Content artifact={artifact} account={account} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
function Content({
  artifact,
  account,
}: {
  artifact: Artifact
  account: ReturnType<typeof useAccount>
}) {
  return (
    <SharingPanel
      key={`${account.client.sessionId()}:${artifact.id}:${artifact.revision}`}
      client={account.client}
      sourceId={`${artifact.id}:${artifact.revision}`}
      kind="artifact"
      renderFeed={(share, origin, update) => (
        <ArtifactFeedSetup
          artifact={artifact}
          publicationId={share.record.id}
          origin={origin}
          client={account.client}
          encryptedShare={share}
          onShareChange={update}
        />
      )}
      content={{ kind: 'artifact', artifact: artifactPublicationInput(artifact) }}
      legacy={account.publications?.filter((item) => item.sourceId === artifact.id) ?? []}
    />
  )
}
