import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { Effect } from 'effect'
import { Alert, Keyboard } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { attachmentResultSchema, MAX_ATTACHMENT_BYTES } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'

// This controller belongs to the conversation, not a button that moves when the keyboard closes.
export function useAttachmentPicker(taskId: string) {
  const { connected, callEffect } = useRuntime()
  const { busy, error, act } = useAction()
  const select = (source: 'photos' | 'files') => {
    if (!connected) return
    act(() =>
      mobileWorkflow(function* () {
        Keyboard.dismiss()
        const result = yield* nativeEffect(async () => {
          if (source === 'files')
            return DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
          const photos = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            quality: 0.8,
          })
          return {
            canceled: photos.canceled,
            assets:
              photos.assets?.map((asset) => ({
                uri: asset.uri,
                name: asset.fileName ?? asset.uri.split('/').pop() ?? 'photo.jpg',
              })) ?? [],
          }
        })
        if (!result.canceled)
          for (const asset of result.assets) {
            const file = new File(asset.uri)
            if (file.size > MAX_ATTACHMENT_BYTES)
              return yield* Effect.fail(new Error(`${asset.name} is larger than 4 MB`))
            yield* callEffect(
              '/api/attachments/upload',
              {
                taskId,
                id: randomUUID(),
                name: asset.name,
                data: yield* nativeEffect(() => file.base64()),
              },
              attachmentResultSchema,
            )
          }
      }),
    )
  }
  const pick = () => {
    if (!connected || busy) return
    Keyboard.dismiss()
    Alert.alert('Add attachment', 'Choose photos or files', [
      { text: 'Photos', onPress: () => select('photos') },
      { text: 'Files', onPress: () => select('files') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }
  return {
    busy,
    error,
    pick,
  }
}
