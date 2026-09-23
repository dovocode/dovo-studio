import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { Effect } from 'effect'
import { Keyboard } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { attachmentResultSchema, MAX_ATTACHMENT_BYTES } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useAction } from '../ui/use-action'

// This controller belongs to the conversation, not a button that moves when the keyboard closes.
export function useAttachmentPicker(taskId: string) {
  const { connected, callEffect } = useRuntime()
  const { busy, error, act } = useAction()
  const pick = () => {
    if (!connected) return
    act(() =>
      mobileWorkflow(function* () {
        Keyboard.dismiss()
        const result = yield* nativeEffect(() =>
          DocumentPicker.getDocumentAsync({
            multiple: true,
            copyToCacheDirectory: true,
          }),
        )
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
  return {
    busy,
    error,
    pick,
  }
}
