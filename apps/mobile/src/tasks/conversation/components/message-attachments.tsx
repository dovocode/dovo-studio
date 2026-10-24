import { SafeModal } from '../../../ui/layout/safe-modal'
import { EditChatImage } from '../../composer/chat-image-edit-context'
import { nativeEffect, mobileWorkflow } from '../../../runtime/state/native-effect'
import { useEffect } from 'react'
import { runClientEffect, clientTaskScope } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { Image, Pressable, View, ScrollView } from 'react-native'
import { Text } from '../../../ui/content/text'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import {
  attachmentReadSchema,
  taskImageReadSchema,
  isImageAttachment,
  fileSizeLabel,
  responses,
  type Attachment,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { IconButton } from '../../../ui/controls/icon-button'
import { Icon, type IconName } from '../../../ui/controls/icon'
import { useTheme } from '../../../ui/theme'
export function MessageAttachments({
  taskId,
  files = [],
  removable,
  edit,
  remove,
  disabled,
  onBusy,
}: {
  taskId: string
  files?: Attachment[]
  removable?: boolean
  edit?: (id: string) => Promise<void>
  remove?: (id: string) => void
  disabled?: boolean
  onBusy?: (busy: boolean) => void
}) {
  const { styles, colors } = useTheme()

  const { connected, callEffect } = useRuntime()
  const [preview, setPreview] = useApplicationState<{
      attachment: Attachment
      data: string
    } | null>(null),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState(''),
    [previewSize, setPreviewSize] = useApplicationState({ width: 0, height: 0 })
  const act = (operation: () => Promise<void>) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        setBusy(true)
        onBusy?.(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          yield* nativeEffect(() => operation())
        }).pipe(
          Effect.catch((error) =>
            nativeEffect(() => {
              setError(String(error))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              setBusy(false)
              onBusy?.(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  if (!files.length) return null
  return (
    <View
      style={{
        gap: 4,
      }}
    >
      <ScrollView
        keyboardShouldPersistTaps="always"
        nestedScrollEnabled
        style={{ maxHeight: 146, flexGrow: 0 }}
        contentContainerStyle={{ gap: 4 }}
        accessibilityLabel={removable ? 'Draft attachments' : 'Message attachments'}
      >
        {files.map((file) => (
          <View
            key={file.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              width: '100%',
              flexShrink: 0,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              backgroundColor: colors.surface,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Preview ${file.name}`}
              accessibilityState={{ disabled: !connected || busy || disabled }}
              disabled={!connected || busy || disabled}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 6,
                opacity: !connected || busy || disabled ? 0.4 : pressed ? 0.6 : 1,
              })}
              onPress={() =>
                void act(() => {
                  return runClientEffect(
                    mobileWorkflow(function* () {
                      return setPreview(
                        yield* callEffect(
                          '/api/attachments/read',
                          {
                            taskId,
                            id: file.id,
                          },
                          attachmentReadSchema,
                        ),
                      )
                    }),
                  )
                })
              }
            >
              {isImageAttachment(file) ? (
                <AttachmentThumbnail taskId={taskId} file={file} />
              ) : (
                <Icon name="file" size={20} color={colors.muted} />
              )}
              <View
                style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Text
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={{ flex: 1, color: colors.text, fontSize: 12, fontWeight: '500' }}
                >
                  {file.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ flexShrink: 0, color: colors.muted, fontSize: 10 }}
                >
                  {fileSizeLabel(file.size)}
                </Text>
              </View>
            </Pressable>
            {removable && edit && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mime) && (
              <AttachmentAction
                icon="edit"
                label={`Edit ${file.name}`}
                disabled={!connected || busy || disabled}
                onPress={() => void edit(file.id)}
              />
            )}
            {!removable && isImageAttachment(file) && (
              <EditChatImage source={{ taskId, attachmentId: file.id }} label={file.name} />
            )}
            {removable && (
              <AttachmentAction
                icon="close"
                label={`Remove ${file.name}`}
                disabled={!connected || busy || disabled}
                onPress={() =>
                  void act(async () => {
                    if (remove) {
                      remove(file.id)
                      return
                    }
                    return runClientEffect(
                      mobileWorkflow(function* () {
                        yield* callEffect(
                          '/api/attachments/remove',
                          {
                            taskId,
                            id: file.id,
                          },
                          responses.ok,
                        )
                      }),
                    )
                  })
                }
              />
            )}
          </View>
        ))}
      </ScrollView>
      {!!error && !preview && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <SafeModal visible={!!preview} animationType="slide" onRequestClose={() => setPreview(null)}>
        <View style={styles.screen}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 8,
            }}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: colors.text }}
            >
              {preview?.attachment.name}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, flexShrink: 0 }}>
              {preview && !removable && isImageAttachment(preview.attachment) && (
                <EditChatImage
                  source={{ taskId, attachmentId: preview.attachment.id }}
                  glass
                  label={preview.attachment.name}
                  onEdit={() => setPreview(null)}
                />
              )}
              <IconButton
                label="Share file"
                icon="share"
                variant="glass"
                disabled={busy}
                onPress={() =>
                  void act(() => {
                    return runClientEffect(
                      mobileWorkflow(function* () {
                        if (!preview) return
                        if (!(yield* nativeEffect(() => Sharing.isAvailableAsync())))
                          return yield* Effect.fail(
                            new Error('File sharing is unavailable on this device'),
                          )
                        const file = new File(
                          Paths.cache,
                          `${preview.attachment.id}-${preview.attachment.name}`,
                        )
                        yield* nativeEffect(() => file.write(preview.data, { encoding: 'base64' }))
                        yield* nativeEffect(() =>
                          Sharing.shareAsync(file.uri, {
                            mimeType: preview.attachment.mime,
                          }),
                        )
                      }),
                    )
                  })
                }
              />
              <IconButton
                label="Close preview"
                icon="close"
                variant="glass"
                onPress={() => setPreview(null)}
              />
            </View>
          </View>
          {!!error && (
            <Text accessibilityRole="alert" style={[styles.error, { paddingHorizontal: 16 }]}>
              {error}
            </Text>
          )}
          <View
            style={{ flex: 1, minHeight: 0 }}
            onLayout={({ nativeEvent: { layout } }) =>
              setPreviewSize({ width: layout.width, height: layout.height })
            }
          >
            {preview &&
              (isImageAttachment(preview.attachment) ? (
                <ScrollView
                  key={preview.attachment.id}
                  accessibilityLabel="Image preview"
                  style={{ flex: 1 }}
                  contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
                  maximumZoomScale={4}
                  minimumZoomScale={1}
                  centerContent
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                >
                  <Image
                    source={{ uri: `data:${preview.attachment.mime};base64,${preview.data}` }}
                    accessibilityLabel={preview.attachment.name}
                    style={{ width: previewSize.width, height: previewSize.height }}
                    resizeMode="contain"
                  />
                </ScrollView>
              ) : (
                <ScrollView
                  accessibilityLabel="File preview"
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.content}
                >
                  <Text selectable style={styles.text}>
                    {textPreview(preview.data)}
                  </Text>
                </ScrollView>
              ))}
          </View>
        </View>
      </SafeModal>
    </View>
  )
}

// Keep composer actions in the TextInput's responder tree so taps do not dismiss the keyboard.
function AttachmentAction({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string
  icon: IconName
  disabled?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        flexShrink: 0,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.selection : 'transparent',
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon name={icon} size={16} color={colors.muted} />
    </Pressable>
  )
}

function AttachmentThumbnail({ taskId, file }: { taskId: string; file: Attachment }) {
  const { connected, readEffect } = useRuntime()
  const [uri, setUri] = useApplicationState('')
  const [thumbnailError, setThumbnailError] = useApplicationState('')
  useEffect(() => {
    setUri('')
    setThumbnailError('')
    if (!connected) return
    let cancelled = false
    const requests = clientTaskScope()
    void requests.run(
      readEffect(
        '/api/tasks/images/read',
        { taskId, attachmentId: file.id, maxSize: 128 },
        taskImageReadSchema,
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (!cancelled) setUri(result.uri)
          }),
        ),
        Effect.catch((reason) =>
          Effect.sync(() => {
            if (!cancelled) setThumbnailError(reason.message)
          }),
        ),
      ),
    )
    return () => {
      cancelled = true
      void requests.stop()
    }
  }, [connected, readEffect, taskId, file.id, file.mime])
  if (thumbnailError || !uri)
    return (
      <View
        style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
        accessibilityLabel={
          thumbnailError ? `Preview unavailable: ${thumbnailError}` : 'Loading preview'
        }
      >
        <Icon name="fileImage" size={20} />
      </View>
    )
  return (
    <Image
      source={uri ? { uri } : undefined}
      accessibilityLabel={file.name}
      style={{ width: 24, height: 24, borderRadius: 4 }}
      resizeMode="cover"
    />
  )
}
function textPreview(data: string) {
  try {
    const text = new TextDecoder('utf-8', {
      fatal: true,
    }).decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
    return text.includes('\0')
      ? 'Share this file to open it in another app.'
      : text.slice(0, 32000) + (text.length > 32000 ? '\n… Preview truncated' : '')
  } catch {
    return 'Share this file to open it in another app.'
  }
}
