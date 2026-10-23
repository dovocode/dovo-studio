import type { ArtifactReference } from '@dovo/protocol'
import { useMobileAccount } from '../../runtime/connection/account-provider'
import { Text } from './text'
import { useTheme } from '../theme'

export function ArtifactSharedBadge({
  artifact,
}: {
  artifact: Pick<ArtifactReference, 'id' | 'revision'>
}) {
  const account = useMobileAccount()
  const { styles } = useTheme()
  const versions = account.publications?.filter((item) => item.sourceId === artifact.id) ?? []
  const current = versions.find((item) => item.revision === artifact.revision)
  const latest = versions.reduce((max, item) => Math.max(max, item.revision), 0)
  if (!account.directory || !latest) return null
  return (
    <Text
      style={styles.muted}
      accessibilityLabel={
        current
          ? `Version ${artifact.revision} is shared`
          : `Version ${latest} is shared; this version is local`
      }
    >
      {current ? 'Shared' : `Shared v${latest} · This version is local`}
    </Text>
  )
}
