import { SafeModal } from '../layout/safe-modal'
import { memo, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, View } from 'react-native'
import { ArtifactWebView } from './artifact-web-view'
import { InlineArtifact } from './inline-artifact'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as Crypto from 'expo-crypto'
import {
  artifactFile,
  artifactBundleSource,
  artifactLabel,
  artifactDownloadResponseSchema,
  artifactPdfResponseSchema,
  artifactExportPreviewResponseSchema,
  artifactPngResponseSchema,
  type ArtifactPdfOptions,
  artifactHtmlResponseSchema,
  artifactMhtmlResponseSchema,
  artifactSourceMarkdown,
  artifactListSchema,
  artifactLinkLabel,
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
import { useTheme } from '../theme'
import { useOpenAppLink } from './open-link'
import { ArtifactExportEditor } from './artifact-export-editor'
import { ArtifactExportOptions } from './artifact-export-options'
import { ArtifactFormatIcon } from './artifact-presentation'
import { ArtifactSharing } from './artifact-sharing'

export const ArtifactCard = memo(function ArtifactCard({
  reference,
}: {
  reference: ArtifactReference
}) {
  const { colors, styles } = useTheme()

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
          <Text numberOfLines={2} style={[styles.text, { fontWeight: '600' }]}>
            {reference.title}
          </Text>
          <Text style={styles.muted}>
            {artifactLabel(reference)} · Version {reference.revision}
          </Text>
        </View>
        <Icon name="external" size={16} color={colors.muted} />
      </Pressable>
      <InlineArtifact
        key={`${activeId}:${reference.taskId}:${reference.id}:${reference.revision}`}
        reference={reference}
        onOpen={() => setOpen(true)}
      />
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
  const { colors } = useTheme()

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
  const { colors, styles } = useTheme()

  const openLink = useOpenAppLink(taskId)
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
  const [fileSelection, setFileSelection] = useState<{ id: string; path: string }>()
  const selectedFile =
    artifact?.files?.find((file) => fileSelection?.id === id && file.path === fileSelection.path) ??
    artifact?.files?.find((file) => file.path === artifact.entrypoint) ??
    artifact?.files?.[0]
  const sourceArtifact = artifact
    ? artifactBundleSource(artifact, selectedFile?.path ?? '')
    : undefined
  const [listError, setListError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [versionsError, setVersionsError] = useState('')
  const error = listError || previewError
  const [source, setSource] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [exportDraft, setExportDraft] = useState<{ key: string; content: string }>()
  const [editingExport, setEditingExport] = useState<{ key: string; content: string }>()
  const [preparingEditor, setPreparingEditor] = useState(false)
  const editorRequest = useRef(false)
  const exportKey = JSON.stringify([taskId, id, artifact?.revision])
  const draftHtml = exportDraft?.key === exportKey ? exportDraft.content : undefined
  const [picker, setPicker] = useState<'artifacts' | 'versions' | 'export' | 'files'>()
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
    setVersionsError('')
    void read('/api/artifacts/read', { taskId, id, revision }, artifactResponseSchema)
      .then((result) => {
        if (!disposed) setLoaded({ selection, artifact: result.artifact })
      })
      .catch((cause: unknown) => {
        if (!disposed) setPreviewError(cause instanceof Error ? cause.message : String(cause))
      })
    void read('/api/artifacts/versions', { taskId, id }, artifactVersionsSchema)
      .then((history) => {
        if (!disposed) setVersions(history.versions)
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setVersionsError(
            `Version history unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
      })
    return () => {
      disposed = true
    }
  }, [read, taskId, id, metadata?.revision, revision, connected, reload, selection])
  const editExport = async () => {
    if (!artifact || !connected || editorRequest.current) return
    if (draftHtml !== undefined) {
      setEditingExport({ key: exportKey, content: draftHtml })
      return
    }
    editorRequest.current = true
    setPreparingEditor(true)
    try {
      const { content } = await read(
        '/api/artifacts/export-preview',
        { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
        artifactExportPreviewResponseSchema,
      )
      setEditingExport({ key: exportKey, content })
    } catch (cause) {
      Alert.alert('Could not prepare export editor', String(cause))
    } finally {
      editorRequest.current = false
      setPreparingEditor(false)
    }
  }
  const sharingRequest = useRef(false)
  const share = async (
    format: 'source' | 'pdf' | 'png' | 'folder' | 'html' | 'mhtml',
    options?: ArtifactPdfOptions,
    width?: number,
  ) => {
    if (!artifact || sharingRequest.current) return
    sharingRequest.current = true
    setSharing(true)
    let file: File | undefined
    try {
      const edited = draftHtml === undefined ? {} : { draftHtml }
      if (!(await Sharing.isAvailableAsync()))
        throw new Error('Sharing is unavailable on this device')
      const result =
        format === 'png'
          ? await read(
              '/api/artifacts/png',
              { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision, width },
              artifactPngResponseSchema,
            )
          : format === 'html'
            ? await read(
                '/api/artifacts/html',
                { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
                artifactHtmlResponseSchema,
              )
            : format === 'mhtml'
              ? await read(
                  '/api/artifacts/mhtml',
                  {
                    taskId: artifact.taskId,
                    id: artifact.id,
                    revision: artifact.revision,
                    ...edited,
                  },
                  artifactMhtmlResponseSchema,
                )
              : format === 'folder'
                ? await read(
                    '/api/artifacts/download',
                    { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
                    artifactDownloadResponseSchema,
                  )
                : format === 'pdf'
                  ? await read(
                      '/api/artifacts/pdf',
                      {
                        taskId: artifact.taskId,
                        id: artifact.id,
                        revision: artifact.revision,
                        options,
                        ...edited,
                      },
                      artifactPdfResponseSchema,
                    )
                  : selectedFile
                    ? {
                        name: selectedFile.path.split('/').at(-1) ?? 'file',
                        mime:
                          selectedFile.encoding === 'base64'
                            ? 'application/octet-stream'
                            : 'text/plain',
                        data: selectedFile.content,
                      }
                    : { ...artifactFile(artifact), data: artifact.content }
      file = new File(Paths.cache, `artifact-${Crypto.randomUUID()}-${result.name}`)
      await file.write(
        format !== 'source' || selectedFile?.encoding === 'base64'
          ? Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0))
          : result.data,
      )
      await Sharing.shareAsync(file.uri, {
        mimeType: result.mime,
        dialogTitle: artifact.title,
        ...(format === 'pdf'
          ? { UTI: 'com.adobe.pdf' }
          : format === 'png'
            ? { UTI: 'public.png' }
            : format === 'html'
              ? { UTI: 'public.html' }
              : {}),
      })
    } catch (cause) {
      Alert.alert('Could not share artifact', String(cause))
    } finally {
      if (file?.exists) file.delete()
      sharingRequest.current = false
      setSharing(false)
    }
  }
  return (
    <SafeModal animationType="slide" onRequestClose={onClose} contentStyle={{ minHeight: 0 }}>
      <View style={{ flex: 1, minHeight: 0, backgroundColor: colors.background }}>
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
                    ? artifactLabel(metadata)
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
              caption="Artifacts"
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
              caption="Export"
              label="Export artifact"
              selected={picker === 'export'}
              onPress={() => setPicker('export')}
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
          {artifact?.files && (
            <Action
              secondary
              label={`Browse files · ${artifact.files.length}`}
              onPress={() => setPicker('files')}
            />
          )}
          {source && selectedFile && (
            <Text numberOfLines={2} style={styles.muted}>
              {selectedFile.path}
            </Text>
          )}
          {!!versionsError && <Text style={styles.muted}>{versionsError}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!error && (!items || (!!id && !link && !artifact)) && <ActivityIndicator />}
          {items?.length === 0 && links.length === 0 && (
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 32 }}>
              <Icon name="artifactList" size={32} color={colors.muted} />
              <Text style={[styles.text, { fontWeight: '600' }]}>No artifacts yet</Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                Ask your agent to create a document, an interactive preview or a graphic.
              </Text>
            </View>
          )}
        </View>
        {picker === 'export' ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1, minHeight: 0 }}
            contentContainerStyle={{ padding: 16, gap: 16 }}
          >
            <Text style={styles.muted}>Save or share this saved version.</Text>
            <Action
              label={preparingEditor ? 'Preparing editor…' : 'Edit before export'}
              secondary
              disabled={!artifact || !connected || sharing || preparingEditor}
              onPress={() => void editExport()}
            />
            <Text style={styles.muted}>
              {draftHtml !== undefined
                ? 'Edited copy applied to PDF and MHTML. Saved source is unchanged.'
                : 'Edit text, remove elements or mark them as non-printable for PDF and MHTML.'}
            </Text>
            {draftHtml !== undefined && (
              <Action
                label="Reset edits"
                secondary
                disabled={sharing}
                onPress={() => setExportDraft(undefined)}
              />
            )}
            <ArtifactExportOptions
              busy={sharing}
              disabled={!artifact || !connected}
              onPdf={(options) => void share('pdf', options)}
              onPng={(width) => void share('png', undefined, width)}
            />
            {sharing && (
              <Text accessibilityLiveRegion="polite" style={styles.muted}>
                Preparing export…
              </Text>
            )}
            {artifact?.files && (
              <>
                <Action
                  label="Interactive HTML"
                  disabled={!connected || sharing}
                  onPress={() => void share('html')}
                />
                <Text style={styles.muted}>One file with working controls.</Text>
                <Action
                  label="MHTML snapshot"
                  disabled={!connected || sharing}
                  onPress={() => void share('mhtml')}
                />
                <Text style={styles.muted}>Offline page archive without interaction.</Text>
                <Action
                  label="Share folder (ZIP)"
                  disabled={!connected || sharing}
                  onPress={() => void share('folder')}
                />
              </>
            )}
            {artifact && (
              <ArtifactSharing key={`${artifact.id}:${artifact.revision}`} artifact={artifact} />
            )}
            <Action
              label="Share source"
              secondary
              disabled={!artifact || sharing}
              onPress={() => void share('source')}
            />
            <Action label="Back to preview" secondary onPress={() => setPicker(undefined)} />
          </ScrollView>
        ) : picker === 'files' ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            <Action secondary label="Back to preview" onPress={() => setPicker(undefined)} />
            {artifact?.files?.map((file) => (
              <Pressable
                key={file.path}
                accessibilityRole="button"
                accessibilityLabel={file.path}
                accessibilityState={{ selected: selectedFile?.path === file.path }}
                style={{
                  padding: 12,
                  minHeight: 48,
                  borderRadius: 12,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: selectedFile?.path === file.path ? colors.accent : colors.border,
                }}
                onPress={() => {
                  setFileSelection({ id, path: file.path })
                  setSource(true)
                  setPicker(undefined)
                }}
              >
                <Text style={styles.text}>{file.path}</Text>
                {file.path === artifact.entrypoint && (
                  <Text style={styles.muted}>Preview entry file</Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        ) : picker ? (
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
                  <Text style={styles.text}>
                    {picker === 'artifacts' ? item.title : `Version ${item.revision}`}
                  </Text>
                  <Text style={styles.muted}>
                    {artifactLabel(item)} · {new Date(item.updatedAt).toLocaleString()}
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
                  <Text style={styles.text}>{item.title}</Text>
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
            <Text style={[styles.text, { fontWeight: '600', fontSize: 18 }]}>{link.title}</Text>
            <Text style={styles.muted}>{artifactLinkLabel(link.provider)}</Text>
            <Text selectable style={[styles.muted, { textAlign: 'center' }]}>
              {link.url}
            </Text>
            <Action
              label={`Open ${artifactLinkLabel(link.provider)}`}
              onPress={() => {
                void openLink(link.url).catch((cause: unknown) =>
                  Alert.alert('Could not open link', String(cause)),
                )
              }}
            />
          </ScrollView>
        ) : null}
        {artifact && (
          <View style={{ flex: 1, display: picker ? 'none' : 'flex' }}>
            {(artifact.format === 'html' || artifact.format === 'svg') && (
              <View style={{ flex: 1, display: source ? 'none' : 'flex' }}>
                <ArtifactWebView
                  key={`${id}:${artifact.revision}`}
                  content={artifact.content}
                  onError={() => setPreviewError('Could not load artifact preview')}
                />
              </View>
            )}
            {(source || artifact.format === 'code' || artifact.format === 'markdown') &&
              sourceArtifact && (
                <ScrollView
                  contentContainerStyle={{
                    padding: source || artifact.format === 'code' ? 20 : 24,
                  }}
                >
                  {!source && artifact.format === 'markdown' ? (
                    <Markdown text={artifact.content} />
                  ) : sourceArtifact.content.length <= 1024 * 1024 ? (
                    <Markdown text={artifactSourceMarkdown(sourceArtifact)} />
                  ) : (
                    <Text
                      selectable
                      style={{
                        color: colors.text,
                        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                        fontSize: 13,
                        lineHeight: 22,
                      }}
                    >
                      {sourceArtifact.content}
                    </Text>
                  )}
                </ScrollView>
              )}
          </View>
        )}
        {editingExport && (
          <ArtifactExportEditor
            content={editingExport.content}
            onAction={(edit) => {
              if (edit.action === 'apply')
                setExportDraft({ key: editingExport.key, content: edit.content })
              setEditingExport(undefined)
            }}
          />
        )}
      </View>
    </SafeModal>
  )
}
