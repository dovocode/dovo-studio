import type { ArtifactReference } from '@dovo/protocol'
import { useAccount, useAppPreferences, useStudioHost } from '@dovo/studio-core'
import { Share2 } from 'lucide-react'

export function ArtifactSharedBadge({
  artifact,
}: {
  artifact: Pick<ArtifactReference, 'id' | 'revision'>
}) {
  const host = useStudioHost()
  if (!host.accountStorage || !host.openExternalLink) return null
  return (
    <BadgeContent artifact={artifact} storage={host.accountStorage} open={host.openExternalLink} />
  )
}
function BadgeContent({
  artifact,
  storage,
  open,
}: {
  artifact: Pick<ArtifactReference, 'id' | 'revision'>
  storage: NonNullable<ReturnType<typeof useStudioHost>['accountStorage']>
  open: (url: string) => Promise<void>
}) {
  const services = useAppPreferences()
  const account = useAccount(storage, open, services)
  const versions = account.publications?.filter((item) => item.sourceId === artifact.id) ?? []
  const current = versions.find((item) => item.revision === artifact.revision)
  const latest = versions.reduce((max, item) => Math.max(max, item.revision), 0)
  if (!account.directory || !latest) return null
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs ${current ? 'bg-accent text-foreground' : 'bg-muted text-status-warning'}`}
      title={
        current
          ? `Version ${artifact.revision} is shared on ${account.publicationOrigin}`
          : `Version ${latest} is shared; this version has not been published`
      }
    >
      <Share2 aria-hidden="true" className="size-3" />
      {current
        ? `Shared · v${artifact.revision}`
        : latest < artifact.revision
          ? `Shared version is older · v${latest}`
          : `Shared v${latest} · This version is local`}
    </span>
  )
}
