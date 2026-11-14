import { useInterfaceText } from '@dovo/studio-core/interface-language'
import type { ArtifactReference } from '@dovo/protocol'
import { useEncryptedPublication } from '@dovo/studio-core'
import { useMobileAccount } from '../../runtime/connection/account-provider'
import { Text } from './text'
import { useTheme } from '../theme'

export function ArtifactSharedBadge({
  artifact,
}: {
  artifact: Pick<ArtifactReference, 'id' | 'revision'>
}) {
  const uiText = useInterfaceText()

  const account = useMobileAccount()
  const encrypted = useEncryptedPublication(
    account.client,
    `${artifact.id}:${artifact.revision}`,
    !!account.directory,
  )
  const { colors, styles } = useTheme()
  const versions = account.publications?.filter((item) => item.sourceId === artifact.id) ?? []
  const current = versions.find((item) => item.revision === artifact.revision)
  const latest = versions.reduce((max, item) => Math.max(max, item.revision), 0)
  if (!account.directory || (!latest && !encrypted.shared)) return null
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
          color: current || encrypted.shared ? colors.text : colors.warning,
        },
      ]}
      accessibilityLabel={
        encrypted.shared
          ? uiText('Version {value0} is shared with end-to-end encryption', {
              value0: artifact.revision,
            })
          : current
            ? uiText('Version {value0} is shared', { value0: artifact.revision })
            : uiText('Version {value0} is shared; this version is local', { value0: latest })
      }
    >
      {encrypted.shared
        ? uiText('Shared · Encrypted')
        : current
          ? uiText('Shared · v{value0}', { value0: artifact.revision })
          : latest < artifact.revision
            ? uiText('Shared version is older · v{value0}', { value0: latest })
            : uiText('Shared v{value0} · This version is local', { value0: latest })}
    </Text>
  )
}
