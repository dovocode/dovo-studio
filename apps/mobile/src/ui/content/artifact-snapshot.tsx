import { useEffect, useState } from 'react'
import { Image, View } from 'react-native'
import { artifactSnapshotSchema, type ArtifactMetadata, type RuntimeProfile } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { ArtifactFormatIcon } from './artifact-presentation'
import { Text } from './text'
import { useTheme } from '../theme'

export function ArtifactSnapshot({
  profile,
  artifact,
}: {
  profile: RuntimeProfile
  artifact: ArtifactMetadata
}) {
  const { readRuntime } = useRuntime()
  const { colors } = useTheme()
  const [preview, setPreview] = useState<typeof artifactSnapshotSchema.Type>()
  const [error, setError] = useState('')
  useEffect(() => {
    let stopped = false
    setPreview(undefined)
    setError('')
    void readRuntime(
      profile,
      '/api/artifacts/snapshot',
      { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
      artifactSnapshotSchema,
    )
      .then((result) => {
        if (!stopped) setPreview(result)
      })
      .catch((cause: unknown) => {
        if (!stopped) setError(String(cause))
      })
    return () => {
      stopped = true
    }
  }, [readRuntime, profile, artifact.id, artifact.taskId, artifact.revision])
  return (
    <View
      accessible={false}
      style={{
        height: 140,
        overflow: 'hidden',
        backgroundColor: colors.elevated,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {preview?.image ? (
        <Image
          source={{ uri: preview.image }}
          resizeMode="cover"
          style={{ width: '100%', height: '100%' }}
        />
      ) : preview?.excerpt ? (
        <Text
          numberOfLines={8}
          style={{
            padding: 16,
            alignSelf: 'stretch',
            fontSize: 10,
            lineHeight: 15,
            color: colors.muted,
          }}
        >
          {preview.excerpt}
        </Text>
      ) : (
        <ArtifactFormatIcon format={artifact.format} large />
      )}
      {!!error && (
        <Text
          style={{ position: 'absolute', bottom: 4, right: 8, fontSize: 10, color: colors.muted }}
        >
          Snapshot unavailable
        </Text>
      )}
    </View>
  )
}
