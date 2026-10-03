import { SafeModal } from '../../../ui/layout/safe-modal'
import { nativeEffect, mobileWorkflow } from '../../../runtime/state/native-effect'
import { useEffect } from 'react'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { Image, View, ScrollView } from 'react-native'
import { Text } from '../../../ui/content/text'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { attachmentReadSchema, isImageAttachment, responses, type Attachment } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { Action } from '../../../ui/controls/action'
import { styles } from '../../../ui/theme'
export function MessageAttachments({
  taskId,
  files = [],
  removable,
  disabled,
  onBusy,
}: {
  taskId: string
  files?: Attachment[]
  removable?: boolean
  disabled?: boolean
  onBusy?: (busy: boolean) => void
}) {
  const { connected, callEffect } = useRuntime()
  const [preview, setPreview] = useApplicationState<{
      attachment: Attachment
      data: string
    } | null>(null),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const act = (operation: () => Promise<void>) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        setBusy(true)
        onBusy?.(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          yield* nativeEffect(() => operation())
        }).pipe(
          Effect.catchAll((error) =>
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
      {files.map((file) => (
        <View key={file.id} style={styles.row}>
          {isImageAttachment(file) && <AttachmentThumbnail taskId={taskId} file={file} />}
          <Action
            secondary
            label={`File: ${file.name}`}
            disabled={!connected || busy || disabled}
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
          />
          {removable && (
            <Action
              secondary
              label={`Remove ${file.name}`}
              disabled={!connected || busy || disabled}
              onPress={() =>
                void act(() => {
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
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <SafeModal visible={!!preview} animationType="slide" onRequestClose={() => setPreview(null)}>
        <View style={styles.screen}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>{preview?.attachment.name}</Text>
            <Action secondary label="Close preview" onPress={() => setPreview(null)} />
            {preview &&
              (isImageAttachment(preview.attachment) ? (
                <Image
                  source={{
                    uri: `data:${preview.attachment.mime};base64,${preview.data}`,
                  }}
                  accessibilityLabel={preview.attachment.name}
                  style={{
                    height: 320,
                    width: '100%',
                  }}
                  resizeMode="contain"
                />
              ) : (
                <Text selectable style={styles.text}>
                  {textPreview(preview.data)}
                </Text>
              ))}
            <Action
              label="Share file"
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
                      file.write(preview.data, {
                        encoding: 'base64',
                      })
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
            {!!error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>
        </View>
      </SafeModal>
    </View>
  )
}

function AttachmentThumbnail({ taskId, file }: { taskId: string; file: Attachment }) {
  const { connected, callEffect } = useRuntime()
  const [uri, setUri] = useApplicationState('')
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    void runClientEffect(
      callEffect('/api/attachments/read', { taskId, id: file.id }, attachmentReadSchema),
    )
      .then((result) => {
        if (!cancelled) setUri(`data:${file.mime};base64,${result.data}`)
      })
      .catch(() => {
        /* The attachment remains available through its file action. */
      })
    return () => {
      cancelled = true
    }
  }, [connected, callEffect, taskId, file.id, file.mime])
  return (
    <Image
      source={uri ? { uri } : undefined}
      accessibilityLabel={file.name}
      style={{ width: 40, height: 40, borderRadius: 6 }}
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
