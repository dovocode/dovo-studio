import { useState } from 'react'
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
  const { call, connected } = useRuntime()
  const [preview, setPreview] = useState<{ attachment: Attachment; data: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const act = async (operation: () => Promise<void>) => {
    setBusy(true)
    onBusy?.(true)
    setError('')
    try {
      await operation()
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }
  if (!files.length) return null
  return (
    <View style={{ gap: 4 }}>
      {files.map((file) => (
        <View key={file.id} style={styles.row}>
          <Action
            secondary
            label={`File: ${file.name}`}
            disabled={!connected || busy || disabled}
            onPress={() =>
              void act(async () =>
                setPreview(
                  await call(
                    '/api/attachments/read',
                    { taskId, id: file.id },
                    attachmentReadSchema,
                  ),
                ),
              )
            }
          />
          {removable && (
            <Action
              secondary
              label={`Remove ${file.name}`}
              disabled={!connected || busy || disabled}
              onPress={() =>
                void act(async () => {
                  await call('/api/attachments/remove', { taskId, id: file.id }, responses.ok)
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
                    source={{ uri: `data:${preview.attachment.mime};base64,${preview.data}` }}
                    accessibilityLabel={preview.attachment.name}
                    style={{ height: 320, width: '100%' }}
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
                  void act(async () => {
                    if (!preview) return
                    if (!(await Sharing.isAvailableAsync()))
                      throw new Error('File sharing is unavailable on this device')
                    const file = new File(
                      Paths.cache,
                      `${preview.attachment.id}-${preview.attachment.name}`,
                    )
                    file.write(preview.data, { encoding: 'base64' })
                    await Sharing.shareAsync(file.uri, { mimeType: preview.attachment.mime })
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
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
    )
    return text.includes('\0')
      ? 'Share this file to open it in another app.'
      : text.slice(0, 32000) + (text.length > 32000 ? '\n… Preview truncated' : '')
  } catch {
    return 'Share this file to open it in another app.'
  }
}
