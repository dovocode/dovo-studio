import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { Alert, Keyboard, Linking, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { isHeicAttachment, jpegAttachmentName } from './attachment-images'
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
              ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
              : await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ['images'],
                  allowsMultipleSelection: true,
                  quality: 0.8,
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
        if (!result.canceled)
          for (const asset of result.assets) {
            const prepared = yield* nativeEffect(async () => {
              if (!isHeicAttachment(asset)) return asset
              const context = ImageManipulator.manipulate(asset.uri)
              try {
                const image = await context.renderAsync()
                try {
                  const converted = await image.saveAsync({
                    format: SaveFormat.JPEG,
                    compress: 0.8,
                  })
                  return { ...asset, uri: converted.uri, name: jpegAttachmentName(asset.name) }
                } finally {
                  image.release()
                }
              } finally {
                context.release()
              }
            })
            const data = yield* nativeEffect(async () => {
              const file = new File(prepared.uri)
              try {
                if (file.size > MAX_ATTACHMENT_BYTES)
                  throw new Error(`${prepared.name} is larger than 4 MB`)
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
          }
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
  }
}
