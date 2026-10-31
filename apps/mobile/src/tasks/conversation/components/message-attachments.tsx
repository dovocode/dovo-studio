import { AttachmentArchive } from './attachment-archive'
import { SafeModal } from '../../../ui/layout/safe-modal'
import { EditChatImage } from '../../composer/chat-image-edit-context'
import { nativeEffect, mobileWorkflow } from '../../../runtime/state/native-effect'
import { useEffect, useRef } from 'react'
import { runClientEffect, clientTaskScope } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { AppState, Image, Pressable, View, ScrollView } from 'react-native'
import { useIsFocused } from 'expo-router'
import { WebView } from 'react-native-webview'
import { Text } from '../../../ui/content/text'
import { shareAttachment } from './attachment-share'
import {
  attachmentReadSchema,
  taskImageReadSchema,
  isImageAttachment,
  isZipAttachment,
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
  draftAttachmentDisabled,
}: {
  taskId: string
  files?: Attachment[]
  removable?: boolean
  edit?: (id: string) => Promise<void>
  remove?: (id: string) => void
  disabled?: boolean
  onBusy?: (busy: boolean) => void
  draftAttachmentDisabled?: boolean
}) {
  const { styles, colors } = useTheme()
  const generation = useRef(0)

  const { connected, callEffect } = useRuntime()
  const [archive, setArchive] = useApplicationState<Attachment | null>(null)
  const [preview, setPreview] = useApplicationState<{
      attachment: Attachment
      data: string
    } | null>(null),
    [busy, setBusy] = useApplicationState(false),
    [readingPreview, setReadingPreview] = useApplicationState(false),
    [error, setError] = useApplicationState(''),
    [previewSize, setPreviewSize] = useApplicationState({ width: 0, height: 0 })
  useEffect(() => {
    setPreview(null)
    return () => {
      generation.current++
    }
  }, [taskId])
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
      {(readingPreview || preview) && (
        <PreviewLifecycle
          onDeactivate={() => {
            generation.current++
            setPreview(null)
          }}
        />
      )}
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
              onPress={() => {
                if (isZipAttachment(file)) {
                  setArchive(file)
                  return
                }
                setReadingPreview(true)
                void act(() =>
                  runClientEffect(
                    mobileWorkflow(function* () {
                      const current = generation.current
                      const result = yield* callEffect(
                        '/api/attachments/read',
                        { taskId, id: file.id },
                        attachmentReadSchema,
                      )
                      if (current === generation.current && AppState.currentState === 'active')
                        setPreview(result)
                    }),
                  ),
                ).finally(() => setReadingPreview(false))
              }}
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
      {archive && (
        <AttachmentArchive
          key={archive.id}
          taskId={taskId}
          attachment={archive}
          onClose={() => setArchive(null)}
          onBusy={onBusy}
          disabled={draftAttachmentDisabled}
        />
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
                        yield* nativeEffect(() =>
                          shareAttachment(
                            preview.attachment.name,
                            preview.attachment.mime,
                            preview.data,
                          ),
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
              ) : /^(audio|video)\//.test(preview.attachment.mime) ? (
                <AttachmentMedia key={preview.attachment.id} {...preview} />
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

function PreviewLifecycle({ onDeactivate }: { onDeactivate: () => void }) {
  const focused = useIsFocused()
  const deactivate = useRef(onDeactivate)
  deactivate.current = onDeactivate
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') deactivate.current()
    })
    if (AppState.currentState !== 'active') deactivate.current()
    return () => subscription.remove()
  }, [])
  useEffect(() => {
    if (!focused) deactivate.current()
  }, [focused])
  return null
}

function AttachmentMedia({ attachment, data }: { attachment: Attachment; data: string }) {
  const { styles } = useTheme()
  const [status, setStatus] = useApplicationState<'loading' | 'ready' | 'error'>('loading')
  const tag = attachment.mime.startsWith('video/') ? 'video' : 'audio'
  const encoded = JSON.stringify(data).replace(/</g, '\\u003c')
  const mime = JSON.stringify(attachment.mime).replace(/</g, '\\u003c')
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh"><${tag} controls playsinline preload="metadata" aria-label="Media playback" style="width:100%;max-height:100%"></${tag}><script>
const media=document.querySelector('${tag}');
const notify=state=>window.ReactNativeWebView.postMessage(state);
let timer;
const clear=()=>clearTimeout(timer);
const ready=()=>{clear();notify('ready')};
const failed=()=>{clear();notify('error')};
const waiting=()=>{clear();notify('loading');timer=setTimeout(failed,10000)};
media.onloadedmetadata=ready;media.onplaying=ready;media.onpause=ready;
media.onerror=failed;media.onwaiting=waiting;media.onstalled=waiting;
try{
  const data=atob(${encoded});const bytes=Uint8Array.from(data,c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:${mime}}));
  waiting();media.src=url;
  window.addEventListener('pagehide',()=>{clear();media.pause();URL.revokeObjectURL(url)},{once:true});
}catch{failed()}
</script></body></html>`
  return (
    <View style={{ flex: 1 }}>
      <WebView
        accessibilityLabel={`Play ${attachment.name}`}
        source={{ html }}
        originWhitelist={['about:blank']}
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        mediaPlaybackRequiresUserAction
        allowsInlineMediaPlayback
        onMessage={(event) => {
          if (
            event.nativeEvent.data === 'loading' ||
            event.nativeEvent.data === 'ready' ||
            event.nativeEvent.data === 'error'
          )
            setStatus(event.nativeEvent.data)
        }}
        onError={() => setStatus('error')}
        onHttpError={() => setStatus('error')}
      />
      {status === 'loading' && <Text accessibilityRole="status">Loading media…</Text>}
      {status === 'error' && (
        <Text accessibilityRole="alert" style={styles.error}>
          Unable to play this file. Share it to open elsewhere.
        </Text>
      )}
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
