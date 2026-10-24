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
  const { colors, styles } = useTheme()
  const versions = account.publications?.filter((item) => item.sourceId === artifact.id) ?? []
  const current = versions.find((item) => item.revision === artifact.revision)
  const latest = versions.reduce((max, item) => Math.max(max, item.revision), 0)
  if (!account.directory || !latest) return null
  return (
    <Text
      style={[
        styles.muted,
        {
          alignSelf: 'flex-start',
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 4,
          backgroundColor: colors.selection,
          color: current ? colors.text : colors.warning,
        },
      ]}
      accessibilityLabel={
        current
          ? `Version ${artifact.revision} is shared`
          : `Version ${latest} is shared; this version is local`
      }
    >
      {current
        ? `Shared · v${artifact.revision}`
        : latest < artifact.revision
          ? `Shared version is older · v${latest}`
          : `Shared v${latest} · This version is local`}
    </Text>
  )
}
