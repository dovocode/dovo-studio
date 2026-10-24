import { useImageEditor } from './image-editor'
import { Effect } from 'effect'
import { useRef } from 'react'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { Alert, Keyboard, Linking, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { optimizeAttachmentImage } from './optimize-attachment-image'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import {
  attachmentResultSchema,
  attachmentReadSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type Attachment,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'

export type AttachmentAsset = { uri: string; name: string; mimeType?: string | null }

// This controller belongs to the conversation, not a button that moves when the keyboard closes.
export function useAttachmentPicker(
  taskId: string,
  editing?: {
    messageId: string
    files: Attachment[]
    uploaded: (file: Attachment, replaceId?: string) => void
  },
) {
  const { connected, callEffect, snapshot } = useRuntime()
  const { busy, error, act, run } = useAction()
  const imageEditor = useImageEditor()
  const uploading = useRef(false)
  const prepare = async (asset: AttachmentAsset, replacing: boolean, editChatImage: boolean) => {
    const temporary = new Set<string>()
    let prepared: AttachmentAsset | null = null
    try {
      const optimized = await optimizeAttachmentImage(asset)
      if (optimized.uri !== asset.uri) temporary.add(optimized.uri)
      const edited = await imageEditor.edit(optimized, editChatImage)
      if (!edited || (replacing && edited === optimized)) return null
      if (edited.uri !== optimized.uri) temporary.add(edited.uri)
      prepared = edited === optimized ? optimized : await optimizeAttachmentImage(edited)
      return prepared
    } finally {
      for (const uri of temporary) if (uri !== prepared?.uri) new File(uri).delete()
    }
  }
  const uploadAssets = (assets: AttachmentAsset[], replaceId?: string, editChatImage = false) =>
    mobileWorkflow(function* () {
      const count =
        (editing
          ? editing.files.length
          : snapshot?.workspace.tasks.find((task) => task.id === taskId)?.draftAttachments
              ?.length) ?? 0
      let accepted = 0
      const rejected: string[] = []
      for (const asset of assets) {
        if (count - (replaceId ? 1 : 0) + accepted >= MAX_ATTACHMENTS) {
          rejected.push(`${asset.name}: attach up to 5 files per message.`)
          continue
        }
        yield* mobileWorkflow(function* () {
          const prepared = yield* nativeEffect(() => prepare(asset, !!replaceId, editChatImage))
          if (!prepared) return
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
          const result = yield* callEffect(
            replaceId ? '/api/attachments/replace' : '/api/attachments/upload',
            {
              taskId,
              queuedMessageId: editing?.messageId,
              id: randomUUID(),
              name: prepared.name,
              data,
              ...(replaceId ? { replaceId } : {}),
            },
            attachmentResultSchema,
          )
          editing?.uploaded(result.attachment, replaceId)
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
  const upload = (assets: AttachmentAsset[], editChatImage = false) => {
    if (!connected) return Promise.reject(new Error('Reconnect to attach files.'))
    if (busy || uploading.current)
      return Promise.reject(new Error('Wait for the current attachment operation to finish.'))
    uploading.current = true
    return run(() => uploadAssets(assets, undefined, editChatImage)).finally(() => {
      uploading.current = false
    })
  }
  const edit = (id: string) => {
    if (!connected || busy || uploading.current) return Promise.resolve()
    uploading.current = true
    return run(() =>
      mobileWorkflow(function* () {
        const previous = yield* callEffect(
          '/api/attachments/read',
          { taskId, id },
          attachmentReadSchema,
        )
        const file = new File(Paths.cache, `image-edit-${randomUUID()}`)
        yield* mobileWorkflow(function* () {
          yield* nativeEffect(() => file.write(previous.data, { encoding: 'base64' }))
          yield* uploadAssets(
            [{ uri: file.uri, name: previous.attachment.name, mimeType: previous.attachment.mime }],
            id,
          )
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (file.exists) file.delete()
            }),
          ),
        )
      }),
    ).finally(() => {
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
    edit,
    editor: imageEditor.editor,
    busy,
    error,
    pick,
    upload,
  }
}
