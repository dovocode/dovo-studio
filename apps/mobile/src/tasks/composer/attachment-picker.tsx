import { Effect } from 'effect'
import { useRef } from 'react'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { Alert, Keyboard, Linking, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { optimizeAttachmentImage } from './optimize-attachment-image'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { attachmentResultSchema, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'

export type AttachmentAsset = { uri: string; name: string; mimeType?: string | null }

// This controller belongs to the conversation, not a button that moves when the keyboard closes.
export function useAttachmentPicker(taskId: string) {
  const { connected, callEffect, snapshot } = useRuntime()
  const { busy, error, act, run } = useAction()
  const uploading = useRef(false)
  const uploadAssets = (assets: AttachmentAsset[]) =>
    mobileWorkflow(function* () {
      const count =
        snapshot?.workspace.tasks.find((task) => task.id === taskId)?.draftAttachments?.length ?? 0
      let accepted = 0
      const rejected: string[] = []
      for (const asset of assets) {
        if (count + accepted >= MAX_ATTACHMENTS) {
          rejected.push(`${asset.name}: attach up to 5 files per message.`)
          continue
        }
        yield* mobileWorkflow(function* () {
          const prepared = yield* nativeEffect(() => optimizeAttachmentImage(asset))
          const data = yield* nativeEffect(async () => {
            const file = new File(prepared.uri)
            try {
              if (file.size > MAX_ATTACHMENT_BYTES)
                throw new Error(`${prepared.name} is larger than 5 MB`)
              return await file.base64()
            } finally {
              if (prepared.uri !== asset.uri) file.delete()
            }
          })
          yield* callEffect(
            '/api/attachments/upload',
            { taskId, id: randomUUID(), name: prepared.name, data },
            attachmentResultSchema,
          )
          accepted++
        }).pipe(
          Effect.catch((cause) =>
            Effect.sync(() => {
              rejected.push(`${asset.name}: ${cause.message}`)
            }),
          ),
        )
      }
      if (rejected.length) throw new Error(rejected.join('\n'))
    })
  const upload = (assets: AttachmentAsset[]) => {
    if (!connected) return Promise.reject(new Error('Reconnect to attach files.'))
    if (busy || uploading.current)
      return Promise.reject(new Error('Wait for the current attachment operation to finish.'))
    uploading.current = true
    return run(() => uploadAssets(assets)).finally(() => {
      uploading.current = false
    })
  }
  const select = (source: 'photos' | 'files' | 'camera') => {
    if (!connected) return
    act(() =>
      mobileWorkflow(function* () {
        Keyboard.dismiss()
        const result = yield* nativeEffect(async () => {
          if (source === 'files')
            return DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
          if (source === 'camera') {
            const permission = await ImagePicker.requestCameraPermissionsAsync()
            if (!permission.granted) {
              Alert.alert(
                'Camera access needed',
                'Allow camera access in Settings to take a photo.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => void Linking.openSettings() },
                ],
              )
              return { canceled: true, assets: [] }
            }
          }
          const photos =
            source === 'camera'
              ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
              : await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['images'],
                  allowsMultipleSelection: true,
                  quality: 1,
                })
          return {
            canceled: photos.canceled,
            assets:
              photos.assets?.map((asset) => ({
                uri: asset.uri,
                mimeType: asset.mimeType,
                name: asset.fileName ?? asset.uri.split('/').pop() ?? 'photo.jpg',
              })) ?? [],
          }
        })
        if (!result.canceled) yield* uploadAssets(result.assets)
      }),
    )
  }
  const pick = () => {
    if (!connected || busy) return
    Keyboard.dismiss()
    const choices = [
      { text: 'Camera', onPress: () => select('camera') },
      { text: 'Photos', onPress: () => select('photos') },
      { text: 'Files', onPress: () => select('files') },
    ]
    Alert.alert(
      'Add attachment',
      'Take a photo or choose an attachment',
      Platform.OS === 'android' ? choices : [...choices, { text: 'Cancel', style: 'cancel' }],
      { cancelable: true },
    )
  }
  return {
    busy,
    error,
    pick,
    upload,
  }
}
