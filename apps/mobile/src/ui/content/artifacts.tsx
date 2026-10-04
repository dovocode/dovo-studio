import { SafeModal } from '../layout/safe-modal'
import { memo, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, View } from 'react-native'
import WebView from 'react-native-webview'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as Crypto from 'expo-crypto'
import {
  artifactFile,
  artifactFormatLabels,
  artifactListSchema,
  artifactLinkLabel,
  artifactPreviewHtml,
  artifactResponseSchema,
  artifactVersionsSchema,
  type Artifact,
  type ArtifactMetadata,
  type ArtifactReference,
  type ArtifactLink,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from './text'
import { Markdown } from './markdown'
import { Action } from '../controls/action'
import { Icon, type IconName } from '../controls/icon'
import { IconButton } from '../controls/icon-button'
import { colors, styles } from '../theme'
import { openAppLink } from './open-link'
import { ArtifactFormatIcon } from './artifact-presentation'

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
        <ArtifactFormatIcon format={reference.format} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={2} style={{ fontWeight: '600' }}>
            {reference.title}
          </Text>
          <Text style={styles.muted}>
            {artifactFormatLabels[reference.format]} · Version {reference.revision}
          </Text>
        </View>
        <Icon name="external" size={16} color={colors.muted} />
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
  const [links, setLinks] = useState<ArtifactLink[]>([])
  const [id, setId] = useState(initialId)
  const link = links.find((item) => item.url === id)
  const metadata = items?.find((item) => item.id === id)
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
      .then(({ artifacts, links = [] }) => {
        if (!disposed) {
          setItems(artifacts)
          setLinks(links)
          setId((previous) =>
            artifacts.some((item) => item.id === previous) ||
            links.some((item) => item.url === previous)
              ? previous
              : artifacts[0]?.id || links[0]?.url || '',
          )
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
    setPreviewError('')
    if (!id || !metadata || !connected) return
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
  }, [read, taskId, id, metadata?.revision, revision, connected, reload, selection])
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
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 18,
            paddingBottom: 14,
            gap: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {metadata ? (
              <ArtifactFormatIcon format={metadata.format} />
            ) : (
              <Icon name="artifactList" color={colors.muted} />
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <Text numberOfLines={2} style={{ fontSize: 18, fontWeight: '600' }}>
                {link?.title ?? artifact?.title ?? metadata?.title ?? 'Thread artifacts'}
              </Text>
              <Text style={styles.muted}>
                {link
                  ? artifactLinkLabel(link.provider)
                  : metadata
                    ? artifactFormatLabels[metadata.format]
                    : 'Saved in this thread'}
                {artifact &&
                  ` · Version ${artifact.revision}${revision === undefined ? ' · Latest' : ''}`}
              </Text>
            </View>
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 4,
              paddingVertical: 6,
              borderRadius: 14,
              backgroundColor: colors.surface,
            }}
          >
            <ArtifactAction
              icon="artifactList"
              caption="Files"
              label="Choose artifact"
              selected={picker === 'artifacts'}
              onPress={() => setPicker('artifacts')}
              disabled={!items?.length && !links.length}
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
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!error && (!items || (!!id && !link && !artifact)) && <ActivityIndicator />}
          {items?.length === 0 && links.length === 0 && (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 32 }}>
              <Icon name="artifactList" size={32} color={colors.muted} />
              <Text style={{ fontWeight: '600' }}>No artifacts yet</Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                Ask your agent to create a document, an interactive preview or a graphic.
              </Text>
            </View>
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
                accessibilityState={{
                  selected: picker === 'artifacts' ? item.id === id : item.revision === revision,
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: (
                    picker === 'artifacts' ? item.id === id : item.revision === revision
                  )
                    ? colors.accent
                    : colors.border,
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                }}
                onPress={() => {
                  if (picker === 'artifacts') {
                    setId(item.id)
                    setRevision(undefined)
                    setSource(false)
                  } else setRevision(item.revision)
                  setPicker(undefined)
                }}
              >
                <ArtifactFormatIcon format={item.format} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text>{picker === 'artifacts' ? item.title : `Version ${item.revision}`}</Text>
                  <Text style={styles.muted}>
                    {artifactFormatLabels[item.format]} ·{' '}
                    {new Date(item.updatedAt).toLocaleString()}
                  </Text>
                </View>
                {(picker === 'artifacts' ? item.id === id : item.revision === revision) && (
                  <Icon name="check" color={colors.accent} />
                )}
              </Pressable>
            ))}
            {picker === 'artifacts' &&
              links.map((item) => (
                <Pressable
                  key={item.url}
                  accessibilityRole="button"
                  style={{
                    padding: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 8,
                  }}
                  onPress={() => {
                    setId(item.url)
                    setRevision(undefined)
                    setSource(false)
                    setPicker(undefined)
                  }}
                >
                  <Text>{item.title}</Text>
                  <Text style={styles.muted}>{artifactLinkLabel(item.provider)}</Text>
                </Pressable>
              ))}
          </ScrollView>
        ) : link ? (
          <ScrollView
            contentContainerStyle={{
              padding: 24,
              gap: 16,
              flexGrow: 1,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Icon name="external" size={36} color={colors.muted} />
            <Text style={{ fontWeight: '600', fontSize: 18 }}>{link.title}</Text>
            <Text style={styles.muted}>{artifactLinkLabel(link.provider)}</Text>
            <Text selectable style={[styles.muted, { textAlign: 'center' }]}>
              {link.url}
            </Text>
            <Action
              label={`Open ${artifactLinkLabel(link.provider)}`}
              onPress={() => {
                void openAppLink(link.url).catch((cause: unknown) =>
                  Alert.alert('Could not open link', String(cause)),
                )
              }}
            />
          </ScrollView>
        ) : (
          artifact &&
          (source || artifact.format === 'code' || artifact.format === 'markdown' ? (
            <ScrollView
              contentContainerStyle={{ padding: source || artifact.format === 'code' ? 20 : 24 }}
            >
              {!source && artifact.format === 'markdown' ? (
                <Markdown text={artifact.content} />
              ) : (
                <Text
                  selectable
                  style={{
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                    fontSize: 13,
                    lineHeight: 22,
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
