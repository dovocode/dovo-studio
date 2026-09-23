import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { Modal, Image, View, ScrollView } from 'react-native'
import { Text } from '../ui/text'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { attachmentReadSchema, isImageAttachment, responses, type Attachment } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
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
      <Modal visible={!!preview} animationType="slide" onRequestClose={() => setPreview(null)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.screen}>
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
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
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
