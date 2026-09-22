import { Keyboard } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { attachmentResultSchema, MAX_ATTACHMENT_BYTES } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useAction } from '../ui/use-action'

// This controller belongs to the conversation, not a button that moves when the keyboard closes.
export function useAttachmentPicker(taskId: string) {
  const { call, connected } = useRuntime()
  const { busy, error, act } = useAction()
  const pick = () => {
    if (!connected) return
    act(async () => {
      Keyboard.dismiss()
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (!result.canceled)
        for (const asset of result.assets) {
          const file = new File(asset.uri)
          if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${asset.name} is larger than 4 MB`)
          await call(
            '/api/attachments/upload',
            { taskId, id: randomUUID(), name: asset.name, data: await file.base64() },
            attachmentResultSchema,
          )
        }
    })
  }
  return { busy, error, pick }
}
