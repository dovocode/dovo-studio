import { useImageEditor } from './image-editor'
import { Effect, Schema } from 'effect'
import { useEffect, useRef, useState } from 'react'
import { clipboardImageData } from './clipboard-image'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { Alert, Keyboard, Linking, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Clipboard from 'expo-clipboard'
import { optimizeAttachmentImage } from './optimize-attachment-image'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import {
  attachmentReadSchema,
  attachmentCommitResultSchema,
  mutableStruct,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type Attachment,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'

export type AttachmentAsset = { id?: string; uri: string; name: string; mimeType?: string | null }

// This controller belongs to the conversation, not a button that moves when the keyboard closes.
export function useAttachmentPicker(
  taskId: string,
  editing?: {
    messageId: string
    files: Attachment[]
    uploaded: (file: Attachment, replaceId?: string) => boolean
  },
  detached?: {
    key: string
    files: Attachment[]
    count?: number
    uploaded: (file: Attachment) => boolean
  },
) {
  const {
    connected,
    callEffect,
    snapshot,
    profile,
    requestAttachmentEffect,
    reviewAttachments,
    readRuntimeEffect,
    refreshRuntimeEffect,
    finishAttachmentEffect,
  } = useRuntime()
  const { busy, error, act, run } = useAction()
  const imageEditor = useImageEditor()
  const uploading = useRef(false)
  const [pasting, setPasting] = useState(false)
  const scopeKey = JSON.stringify([
    taskId,
    profile?.id,
    profile?.connection.address,
    profile?.connection.token,
    editing?.messageId,
    detached?.key,
  ])
  const ownership = useRef({ key: scopeKey, generation: 0, mounted: true })
  if (ownership.current.key !== scopeKey) {
    ownership.current.key = scopeKey
    ownership.current.generation++
  }
  useEffect(() => {
    ownership.current.mounted = true
    return () => {
      ownership.current.mounted = false
    }
  }, [])
  useEffect(
    () => () => {
      if (profile) reviewAttachments(profile)
    },
    [profile, reviewAttachments],
  )
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
  const uploadAssets = (
    assets: AttachmentAsset[],
    replaceId?: string,
    editChatImage = false,
    signal?: AbortSignal,
    initialGuard?: string,
    initialGeneration?: number,
    requireCommitted = false,
  ) =>
    mobileWorkflow(function* () {
      if (!ownership.current.mounted || ownership.current.key !== scopeKey)
        throw new Error('Attachment cancelled because the conversation changed.')
      const generation = initialGeneration ?? ownership.current.generation
      const count =
        (detached
          ? (detached.count ?? detached.files.length)
          : editing
            ? editing.files.length
            : snapshot?.workspace.tasks.find((task) => task.id === taskId)?.draftAttachments
                ?.length) ?? 0
      let accepted = 0
      let held = 0
      let stopped = false
      const rejected: string[] = []
      if (!profile) throw new Error('Connect a computer first.')
      let guard =
        !editing && !detached && assets.length
          ? (initialGuard ??
            (yield* readRuntimeEffect(
              profile,
              '/api/attachments/draft-guard',
              { taskId },
              mutableStruct({ guard: Schema.String }),
            )).guard)
          : null
      for (const asset of assets) {
        // Native share replays keep their attachment IDs, including a crash after server commit.
        if (
          asset.id &&
          snapshot?.workspace.tasks
            .find((task) => task.id === taskId)
            ?.draftAttachments?.some((file) => file.id === asset.id)
        )
          continue
        if (stopped) {
          rejected.push(
            `${asset.name}: not uploaded because the previous attachment did not complete.`,
          )
          continue
        }
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
          if (
            signal?.aborted ||
            !ownership.current.mounted ||
            ownership.current.generation !== generation
          )
            throw new Error('Attachment cancelled because the conversation changed.')
          stopped = true
          const result = yield* requestAttachmentEffect(
            profile,
            {
              taskId,
              queuedMessageId: editing?.messageId,
              detached: !editing,
              id: asset.id ?? randomUUID(),
              name: prepared.name,
              data,
              ...(replaceId ? { replaceId } : {}),
            },
            !!replaceId,
          )
          if (
            !ownership.current.mounted ||
            ownership.current.generation !== generation ||
            signal?.aborted
          ) {
            held++
            reviewAttachments(profile)
          } else if (detached) {
            if (detached.uploaded(result.attachment)) stopped = false
            else {
              held++
              reviewAttachments(profile)
            }
          } else if (editing) {
            if (!editing.uploaded(result.attachment, replaceId)) {
              held++
              reviewAttachments(profile)
            } else stopped = false
          } else {
            const committed = yield* Effect.result(
              readRuntimeEffect(
                profile,
                '/api/attachments/commit-upload',
                { id: result.attachment.id, guard },
                attachmentCommitResultSchema,
              ),
            )
            if (committed._tag === 'Failure') {
              held++
              reviewAttachments(profile)
            } else {
              guard = committed.success.nextGuard
              stopped = false
              yield* refreshRuntimeEffect(profile).pipe(Effect.catch(() => Effect.void))
              yield* finishAttachmentEffect(profile, result.attachment.id).pipe(
                Effect.catch(() => Effect.sync(() => reviewAttachments(profile))),
              )
            }
          }
          accepted++
        }).pipe(
          Effect.catch((cause) =>
            Effect.sync(() => {
              rejected.push(`${asset.name}: ${cause.message}`)
            }),
          ),
        )
      }
      if (held)
        Alert.alert(
          'Attachments saved for review',
          'Open connection status to attach them to the current draft of this task.',
        )
      if (rejected.length) throw new Error(rejected.join('\n'))
      if (held && requireCommitted)
        throw new Error(
          'Shared files are saved for review. Restore them to this draft in connection status, then try again.',
        )
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
  const uploadContext = async (
    assets: AttachmentAsset[],
    signal: AbortSignal,
    requireCommitted = false,
  ) => {
    if (signal.aborted || !ownership.current.mounted || ownership.current.key !== scopeKey)
      throw new Error('Attachment cancelled because the conversation changed.')
    if (!connected) throw new Error('Reconnect to attach files.')
    if (busy || uploading.current)
      throw new Error('Wait for the current attachment operation to finish.')
    uploading.current = true
    let failure: Error | undefined
    try {
      await run(() =>
        uploadAssets(assets, undefined, false, signal, undefined, undefined, requireCommitted).pipe(
          Effect.tapError((cause) =>
            Effect.sync(() => {
              failure = cause
            }),
          ),
        ),
      )
      if (failure) throw failure
    } finally {
      uploading.current = false
    }
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
    if (!connected || busy || uploading.current) return
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
  const pasteImage = () => {
    if (!connected || busy || uploading.current || !profile) return
    uploading.current = true
    setPasting(true)
    const generation = ownership.current.generation
    void run(() =>
      mobileWorkflow(function* () {
        const guard =
          editing || detached
            ? undefined
            : (yield* readRuntimeEffect(
                profile,
                '/api/attachments/draft-guard',
                { taskId },
                mutableStruct({ guard: Schema.String }),
              )).guard
        const image = yield* nativeEffect(() => Clipboard.getImageAsync({ format: 'png' }))
        if (!image) throw new Error('No image found on the clipboard.')
        if (!ownership.current.mounted || ownership.current.generation !== generation)
          throw new Error('The conversation changed before the image was pasted.')
        const data = clipboardImageData(image.data)
        const file = new File(Paths.cache, `clipboard-${randomUUID()}.png`)
        try {
          yield* nativeEffect(() => file.write(data, { encoding: 'base64' }))
          yield* uploadAssets(
            [{ uri: file.uri, name: 'clipboard.png', mimeType: 'image/png' }],
            undefined,
            false,
            undefined,
            guard,
            generation,
          )
        } finally {
          if (file.exists) file.delete()
        }
      }),
    ).finally(() => {
      uploading.current = false
      setPasting(false)
    })
  }
  return {
    edit,
    editor: imageEditor.editor,
    busy: busy || pasting,
    error,
    pick,
    pasteImage,
    select,
    upload,
    uploadContext,
  }
}
