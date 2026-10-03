import { SafeModal } from '../layout/safe-modal'
import { memo, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, View } from 'react-native'
import WebView from 'react-native-webview'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as Crypto from 'expo-crypto'
import {
  artifactFile,
  artifactListSchema,
  artifactPreviewHtml,
  artifactResponseSchema,
  artifactVersionsSchema,
  type Artifact,
  type ArtifactMetadata,
  type ArtifactReference,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from './text'
import { Markdown } from './markdown'
import { Action } from '../controls/action'
import { Icon, type IconName } from '../controls/icon'
import { IconButton } from '../controls/icon-button'
import { colors, styles } from '../theme'

export const ArtifactCard = memo(function ArtifactCard({
  reference,
}: {
  reference: ArtifactReference
}) {
  const { activeId, snapshot } = useRuntime()
  const [open, setOpen] = useState(false)
  if (!snapshot?.artifactsEnabled) return null
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open artifact ${reference.title}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          gap: 12,
          alignItems: 'center',
          padding: 14,
          marginVertical: 8,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon name="artifact" size={22} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={2}>{reference.title}</Text>
          <Text style={styles.muted}>
            {reference.format} · Version {reference.revision} · Open artifact
          </Text>
        </View>
      </Pressable>
      {open && (
        <ArtifactBrowser
          key={`${activeId}:${reference.taskId}`}
          taskId={reference.taskId}
          initialId={reference.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
})
function ArtifactAction({
  label,
  caption,
  icon,
  onPress,
  disabled,
  selected,
}: {
  label: string
  caption: string
  icon: IconName
  onPress: () => void
  disabled?: boolean
  selected?: boolean
}) {
  return (
    <View style={{ width: 44, alignItems: 'center' }}>
      <IconButton
        label={label}
        icon={icon}
        onPress={onPress}
        disabled={disabled}
        selected={selected}
      />
      <Text
        accessible={false}
        numberOfLines={1}
        style={{
          fontSize: 10,
          color: selected ? colors.accent : colors.muted,
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {caption}
      </Text>
    </View>
  )
}
export function ArtifactBrowser({
  taskId,
  initialId = '',
  onClose,
}: {
  taskId: string
  initialId?: string
  onClose: () => void
}) {
  const { read, connected } = useRuntime()
  const [items, setItems] = useState<ArtifactMetadata[]>()
  const [id, setId] = useState(initialId)
  const [revision, setRevision] = useState<number>()
  const [versions, setVersions] = useState<ArtifactMetadata[]>([])
  const [reload, setReload] = useState(0)
  const selection = JSON.stringify([taskId, id, revision, reload])
  const [loaded, setLoaded] = useState<{ selection: string; artifact: Artifact }>()
  const artifact = loaded?.selection === selection ? loaded.artifact : undefined
  const [listError, setListError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const error = listError || previewError
  const [source, setSource] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [picker, setPicker] = useState<'artifacts' | 'versions'>()
  useEffect(() => {
    let disposed = false
    setListError('')
    if (!connected) {
      setListError('Reconnect the runtime to load artifacts.')
      return
    }
    void read('/api/artifacts/list', { taskId }, artifactListSchema)
      .then(({ artifacts }) => {
        if (!disposed) {
          setItems(artifacts)
          setId((previous) => previous || artifacts[0]?.id || '')
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) setListError(String(cause))
      })
    return () => {
      disposed = true
    }
  }, [read, taskId, connected, reload])
  useEffect(() => {
    let disposed = false
    setVersions([])
    if (!id || !connected) return
    setPreviewError('')
    void Promise.all([
      read('/api/artifacts/read', { taskId, id, revision }, artifactResponseSchema),
      read('/api/artifacts/versions', { taskId, id }, artifactVersionsSchema),
    ])
      .then(([result, history]) => {
        if (!disposed) {
          setLoaded({ selection, artifact: result.artifact })
          setVersions(history.versions)
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) setPreviewError(String(cause))
      })
    return () => {
      disposed = true
    }
  }, [read, taskId, id, revision, connected, reload, selection])
  const share = async () => {
    if (!artifact || sharing) return
    setSharing(true)
    const file = artifactFile(artifact)
    const directory = new File(Paths.cache, `artifact-${Crypto.randomUUID()}-${file.name}`)
    try {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error('Sharing is unavailable on this device')
      directory.write(artifact.content)
      await Sharing.shareAsync(directory.uri, { mimeType: file.mime, dialogTitle: artifact.title })
    } catch (cause) {
      Alert.alert('Could not share artifact', String(cause))
    } finally {
      if (directory.exists) directory.delete()
      setSharing(false)
    }
  }
  return (
    <SafeModal animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 4 }}>
            <ArtifactAction
              icon="artifactList"
              caption="Files"
              label="Choose artifact"
              selected={picker === 'artifacts'}
              onPress={() => setPicker('artifacts')}
              disabled={!items?.length}
            />
            <ArtifactAction
              icon="history"
              caption="Versions"
              label={
                revision
                  ? `Choose version · current version ${revision}`
                  : 'Choose version · latest version'
              }
              selected={picker === 'versions'}
              onPress={() => setPicker('versions')}
              disabled={!versions.length}
            />
            <ArtifactAction
              icon={source ? 'preview' : 'code'}
              caption={source ? 'Preview' : 'Code'}
              label={source ? 'Show artifact preview' : 'View artifact source code'}
              onPress={() => setSource((value) => !value)}
              disabled={!artifact}
            />
            <ArtifactAction
              icon="share"
              caption="Share"
              label="Share artifact"
              onPress={() => void share()}
              disabled={!artifact || sharing}
            />
            <ArtifactAction
              icon="refresh"
              caption="Reload"
              label="Refresh artifact"
              onPress={() => setReload((value) => value + 1)}
              disabled={!connected}
            />
            <ArtifactAction
              icon="close"
              caption="Close"
              label="Close artifact preview"
              onPress={onClose}
            />
          </View>
          <Text numberOfLines={2} style={{ fontSize: 18, fontWeight: '600' }}>
            {artifact?.title ?? 'Thread artifacts'}
          </Text>
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!error && (!items || (!!id && !artifact)) && <ActivityIndicator />}
          {items?.length === 0 && (
            <Text style={styles.muted}>
              No artifacts yet. Ask the agent to create a document, diagram or interactive preview.
            </Text>
          )}
        </View>
        {picker ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            <Action secondary label="Back to preview" onPress={() => setPicker(undefined)} />
            {picker === 'versions' && (
              <Action
                secondary
                label="Latest version"
                onPress={() => {
                  setRevision(undefined)
                  setPicker(undefined)
                }}
              />
            )}
            {(picker === 'artifacts' ? (items ?? []) : versions).map((item) => (
              <Pressable
                key={`${item.id}:${item.revision}`}
                accessibilityRole="button"
                style={{ padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}
                onPress={() => {
                  if (picker === 'artifacts') {
                    setId(item.id)
                    setRevision(undefined)
                    setSource(false)
                  } else setRevision(item.revision)
                  setPicker(undefined)
                }}
              >
                <Text>{picker === 'artifacts' ? item.title : `Version ${item.revision}`}</Text>
                <Text style={styles.muted}>
                  {item.format} · {new Date(item.updatedAt).toLocaleString()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          artifact &&
          (source || artifact.format === 'code' || artifact.format === 'markdown' ? (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {!source && artifact.format === 'markdown' ? (
                <Markdown text={artifact.content} />
              ) : (
                <Text
                  selectable
                  style={{
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                    fontSize: 13,
                  }}
                >
                  {artifact.content}
                </Text>
              )}
            </ScrollView>
          ) : (
            <WebView
              key={`${id}:${artifact.revision}`}
              source={{ html: artifactPreviewHtml(artifact.content) }}
              style={{ flex: 1, backgroundColor: '#fff' }}
              originWhitelist={['*']}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              javaScriptCanOpenWindowsAutomatically={false}
              sharedCookiesEnabled={false}
              thirdPartyCookiesEnabled={false}
              onShouldStartLoadWithRequest={(request) =>
                request.url === 'about:blank' ||
                (!request.isTopFrame && /^(about:|data:|blob:)/.test(request.url))
              }
              onError={() => setPreviewError('Could not load artifact preview')}
            />
          ))
        )}
      </View>
    </SafeModal>
  )
}
