import { useEffect, useState } from 'react'
import { Image, View } from 'react-native'
import {
  artifactOwnerKey,
  artifactSnapshotSchema,
  type ArtifactMetadata,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { ArtifactFormatIcon } from './artifact-presentation'
import { Text } from './text'
import { useTheme } from '../theme'

export function ArtifactSnapshot({
  profile,
  artifact,
  connected,
  connecting,
  refreshKey,
}: {
  profile: RuntimeProfile
  artifact: ArtifactMetadata
  connected: boolean
  connecting: boolean
  refreshKey: number
}) {
  const { readRuntime } = useRuntime()
  const { colors } = useTheme()
  const identity = JSON.stringify([
    artifactOwnerKey(profile),
    artifact.taskId,
    artifact.id,
    artifact.revision,
  ])
  const [snapshot, setSnapshot] = useState<{
    identity: string
    preview?: typeof artifactSnapshotSchema.Type
    error?: string
  }>()
  const current = snapshot?.identity === identity ? snapshot : undefined
  const preview = current?.preview
  useEffect(() => {
    if (!connected) return
    let stopped = false
    setSnapshot((previous) =>
      previous?.identity === identity ? { ...previous, error: undefined } : undefined,
    )
    void readRuntime(
      profile,
      '/api/artifacts/snapshot',
      { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
      artifactSnapshotSchema,
    )
      .then((result) => {
        if (!stopped) setSnapshot({ identity, preview: result })
      })
      .catch((cause: unknown) => {
        if (!stopped)
          setSnapshot((previous) => ({
            identity,
            preview: previous?.identity === identity ? previous.preview : undefined,
            error: String(cause),
          }))
      })
    return () => {
      stopped = true
    }
  }, [
    connected,
    refreshKey,
    identity,
    readRuntime,
    profile,
    artifact.id,
    artifact.taskId,
    artifact.revision,
  ])
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
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
      {(!connected || current?.error) && (
        <Text
          style={{
            position: 'absolute',
            bottom: 4,
            right: 8,
            left: 8,
            fontSize: 10,
            color: colors.muted,
            textAlign: 'right',
            backgroundColor: colors.elevated,
          }}
        >
          {!connected ? (connecting ? 'Connecting…' : 'Computer offline') : 'Snapshot unavailable'}
        </Text>
      )}
    </View>
  )
}
