import { View } from 'react-native'
import { artifactPublicationInput, type Artifact } from '@dovo/protocol'
import { useMobileAccount } from '../../runtime/connection/account-provider'
import { ArtifactFeedSetup } from './artifact-feed'
import { SharingPanel } from './sharing-panel'
import { Text } from './text'
import { useTheme } from '../theme'
import { Sheet } from '../layout/sheet'

export function ArtifactSharing({
  artifact,
  onClose,
}: {
  artifact: Artifact
  onClose: () => void
}) {
  const account = useMobileAccount(),
    { styles } = useTheme()
  if (!account.directory || account.deletionPending) return null
  return (
    <Sheet title="Share artifact" onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Text style={styles.muted}>
          {artifact.title} · Version {artifact.revision}
        </Text>
        <SharingPanel
          key={`${account.client.sessionId()}:${artifact.id}:${artifact.revision}`}
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
      </View>
    </Sheet>
  )
}
