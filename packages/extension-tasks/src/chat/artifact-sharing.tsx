import { useState } from 'react'
import { useAccount, useAppPreferences, useStudioHost } from '@dovo/studio-core'
import { artifactPublicationInput, type Artifact, type AccountStorage } from '@dovo/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'
import { Share2 } from 'lucide-react'
import { ArtifactFeedSetup } from './artifact-feed'
import { SharingPanel } from './sharing-panel'

export function ArtifactSharing({ artifact }: { artifact: Artifact }) {
  const host = useStudioHost(),
    [open, setOpen] = useState(false)
  if (!host.accountStorage || !host.openExternalLink) return null
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
          {open && (
            <Content
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
function Content({
  artifact,
  storage,
  open,
}: {
  artifact: Artifact
  storage: AccountStorage
  open: (url: string) => Promise<void>
}) {
  const account = useAccount(storage, open, useAppPreferences())
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
