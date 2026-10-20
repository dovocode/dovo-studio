import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native'
import {
  artifactResponseSchema,
  artifactBundleSource,
  artifactSourceMarkdown,
  type Artifact,
  type ArtifactReference,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../theme'
import { Text } from './text'
import { Markdown } from './markdown'
import { ArtifactWebView } from './artifact-web-view'
import { Action } from '../controls/action'
import { IconButton } from '../controls/icon-button'

export function InlineArtifact({
  reference,
  onOpen,
}: {
  reference: ArtifactReference
  onOpen: () => void
}) {
  const { read, connected } = useRuntime()
  const { colors, styles } = useTheme()
  const [artifact, setArtifact] = useState<Artifact>()
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [source, setSource] = useState(false)
  useEffect(() => {
    let disposed = false
    setArtifact(undefined)
    setError('')
    if (!connected) {
      setError('Reconnect the computer to load this preview.')
      return
    }
    void read(
      '/api/artifacts/read',
      { taskId: reference.taskId, id: reference.id, revision: reference.revision },
      artifactResponseSchema,
    )
      .then(({ artifact }) => {
        if (!disposed) setArtifact(artifact)
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      disposed = true
    }
  }, [read, connected, reference.taskId, reference.id, reference.revision, reload])
  const sourceArtifact = artifact
    ? artifactBundleSource(artifact, artifact.entrypoint ?? '')
    : undefined
  const interactive = artifact?.format === 'html' || artifact?.format === 'svg'
  return (
    <View
      style={{
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          backgroundColor: colors.surface,
        }}
      >
        <Text style={[styles.muted, { flex: 1, fontSize: 11 }]}>
          {reference.fileCount ? `${reference.fileCount} files · ` : ''}Version {reference.revision}
        </Text>
        <IconButton
          label={source ? 'Show rendered artifact' : 'View inline artifact source'}
          icon={source ? 'preview' : 'code'}
          onPress={() => setSource((value) => !value)}
        />
        <IconButton label="Expand inline artifact" icon="expand" onPress={onOpen} />
      </View>
      <View style={{ height: 320 }}>
        {!artifact && !error && <ActivityIndicator color={colors.accent} />}
        {!!error && (
          <View style={{ padding: 16, gap: 8 }}>
            <Text style={styles.error}>{error}</Text>
            <Action
              label="Retry inline preview"
              disabled={!connected}
              onPress={() => setReload((value) => value + 1)}
            />
          </View>
        )}
        {artifact && !error && (
          <>
            {interactive && (
              <View style={{ flex: 1, display: source ? 'none' : 'flex' }}>
                <ArtifactWebView
                  content={artifact.content}
                  onError={() => setError('Could not load artifact preview')}
                />
              </View>
            )}
            {(source || artifact.format === 'code' || artifact.format === 'markdown') && (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                {!source && artifact.format === 'markdown' ? (
                  <Markdown text={artifact.content} />
                ) : (sourceArtifact?.content ?? artifact.content).length <= 1024 * 1024 ? (
                  <Markdown text={artifactSourceMarkdown(sourceArtifact ?? artifact)} />
                ) : (
                  <Text
                    selectable
                    style={{
                      color: colors.text,
                      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                      fontSize: 12,
                      lineHeight: 20,
                    }}
                  >
                    {sourceArtifact?.content ?? artifact.content}
                  </Text>
                )}
              </ScrollView>
            )}
          </>
        )}
      </View>
    </View>
  )
}
