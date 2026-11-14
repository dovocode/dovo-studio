import { useInterfaceText } from '@dovo/studio-core/interface-language'
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

export type AttachmentAsset = {
  id?: string
  uri: string
  name: string
  mimeType?: string | null
  prepared?: boolean
}

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
  const uiText = useInterfaceText()

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
  const activeUpload = useRef<{
    scope: string
    pending: boolean
    done: Promise<string | undefined>
  } | null>(null)
  const [pendingUploads, setPendingUploads] = useState<{
    scope: string
    files: Attachment[]
  } | null>(null)
  const failedUploads = useRef(new Map<string, AttachmentAsset>())
  const [, setFailureVersion] = useState(0)
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
  useEffect(() => {
    const retained = failedUploads.current
    return () => {
      for (const asset of retained.values()) {
        const file = new File(asset.uri)
        if (file.exists) file.delete()
      }
      retained.clear()
    }
  }, [scopeKey])
  const clearFailedUpload = (id: string) => {
    const asset = failedUploads.current.get(id)
    if (!asset) return
    const file = new File(asset.uri)
    if (file.exists) file.delete()
    failedUploads.current.delete(id)
    setFailureVersion((value) => value + 1)
  }
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
  ) => {
    let operation: NonNullable<typeof activeUpload.current> | undefined
    let complete: (failure?: string) => void = () => {}
    let failure: string | undefined
    return mobileWorkflow(function* () {
      if (!profile) throw new Error('Connect a computer first.')
      const generation = initialGeneration ?? ownership.current.generation
      const owns = () =>
        ownership.current.mounted &&
        ownership.current.key === scopeKey &&
        ownership.current.generation === generation &&
        !signal?.aborted
      if (!owns()) throw new Error('Attachment cancelled because the conversation changed.')
      const saved =
        snapshot?.workspace.tasks.find((task) => task.id === taskId)?.draftAttachments ?? []
      const count = detached
        ? (detached.count ?? detached.files.length)
        : editing
          ? editing.files.length
          : saved.length
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
      const batch: { asset: AttachmentAsset; data: string; attachment: Attachment }[] = []
      const rejected: string[] = []
      for (const asset of assets) {
        if (asset.id && saved.some((file) => file.id === asset.id)) {
          clearFailedUpload(asset.id)
          continue
        }
        if (count - (replaceId ? 1 : 0) + batch.length >= MAX_ATTACHMENTS) {
          rejected.push(`${asset.name}: attach up to 5 files per message.`)
          continue
        }
        yield* mobileWorkflow(function* () {
          const prepared = asset.prepared
            ? asset
            : yield* nativeEffect(() => prepare(asset, !!replaceId, editChatImage))
          if (!prepared) return
          const file = new File(prepared.uri)
          const size = file.size
          const data = yield* nativeEffect(async () => {
            try {
              if (size > MAX_ATTACHMENT_BYTES)
                throw new Error(`${prepared.name} is larger than 5 MB`)
              return await file.base64()
            } finally {
              if (prepared.uri !== asset.uri && file.exists) file.delete()
            }
          })
          const id = asset.id ?? randomUUID()
          batch.push({
            asset: { ...prepared, id },
            data,
            attachment: {
              id,
              name: prepared.name,
              size,
              mime: prepared.mimeType ?? 'application/octet-stream',
            },
          })
        }).pipe(
          Effect.catch((cause) =>
            Effect.sync(() => {
              rejected.push(`${asset.name}: ${cause.message}`)
            }),
          ),
        )
      }
      if (!owns()) throw new Error('Attachment cancelled because the conversation changed.')
      if (!editing && !detached && !replaceId && batch.length) {
        const done = new Promise<string | undefined>((resolve) => {
          complete = resolve
        })
        operation = { scope: scopeKey, pending: true, done }
        activeUpload.current = operation
        setPendingUploads({ scope: scopeKey, files: batch.map((item) => item.attachment) })
      }
      let held = 0
      let stopped = false
      for (const item of batch) {
        yield* mobileWorkflow(function* () {
          if (stopped)
            throw new Error('not uploaded because the previous attachment did not complete.')
          if (!owns()) throw new Error('Attachment cancelled because the conversation changed.')
          stopped = true
          const result = yield* requestAttachmentEffect(
            profile,
            {
              taskId,
              queuedMessageId: editing?.messageId,
              detached: !editing,
              id: item.attachment.id,
              name: item.attachment.name,
              data: item.data,
              ...(replaceId ? { replaceId } : {}),
            },
            !!replaceId,
          )
          if (!owns()) {
            held++
            reviewAttachments(profile)
          } else if (detached) {
            if (!detached.uploaded(result.attachment)) {
              held++
              reviewAttachments(profile)
            } else stopped = false
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
              return yield* Effect.fail(committed.failure)
            }
            guard = committed.success.nextGuard
            stopped = false
            yield* refreshRuntimeEffect(profile)
            yield* finishAttachmentEffect(profile, result.attachment.id).pipe(
              Effect.catch(() => Effect.sync(() => reviewAttachments(profile))),
            )
          }
          clearFailedUpload(item.attachment.id)
        }).pipe(
          Effect.catch((cause) =>
            nativeEffect(async () => {
              rejected.push(`${item.attachment.name}: ${cause.message}`)
              if (owns() && !editing && !detached && !replaceId) {
                const previous = failedUploads.current.get(item.attachment.id)
                const file = previous
                  ? new File(previous.uri)
                  : new File(Paths.cache, `pending-attachment-${item.attachment.id}`)
                await file.write(item.data, { encoding: 'base64' })
                failedUploads.current.set(item.attachment.id, {
                  uri: file.uri,
                  name: item.attachment.name,
                  mimeType: item.attachment.mime,
                  id: item.attachment.id,
                  prepared: true,
                })
                setFailureVersion((value) => value + 1)
              }
            }),
          ),
        )
      }
      if (held) {
        Alert.alert(
          uiText('Attachments saved for review'),
          uiText('Open connection status to attach them to the current draft of this task.'),
        )
        if (requireCommitted || operation)
          rejected.push(
            'Files need review before sending. Restore them in connection status, then try again.',
          )
      }
      if (rejected.length) throw new Error(rejected.join('\n'))
    }).pipe(
      Effect.tapError((cause) =>
        Effect.sync(() => {
          failure = cause.message
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (operation) {
            operation.pending = false
            complete(failure)
          }
          setPendingUploads((current) => (current?.scope === scopeKey ? null : current))
        }),
      ),
    )
  }
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
                uiText('Camera access needed'),
                uiText('Allow camera access in Settings to take a photo.'),
                [
                  { text: uiText('Cancel'), style: 'cancel' },
                  { text: uiText('Open Settings'), onPress: () => void Linking.openSettings() },
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
      uiText('Add attachment'),
      uiText('Take a photo or choose an attachment'),
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
  const inFlightFiles = pendingUploads?.scope === scopeKey ? pendingUploads.files : []
  return {
    submissionFiles: inFlightFiles,
    canSubmitWhileUploading: !!inFlightFiles.length && !editing && !detached && !imageEditor.editor,
    failedUploads: [...failedUploads.current.values()].map((asset) => ({
      id: asset.id!,
      name: asset.name,
    })),
    retryUpload: (id: string) => {
      const asset = failedUploads.current.get(id)
      if (asset) void upload([asset])
    },
    discardFailedUpload: clearFailedUpload,
    waitForUploads: async () => {
      const operation = activeUpload.current
      if (operation?.scope === scopeKey && operation.pending) {
        const failure = await operation.done
        if (failure) throw new Error(failure)
      }
      if (!ownership.current.mounted || ownership.current.key !== scopeKey)
        throw new Error('The conversation changed before attachments finished.')
      if (failedUploads.current.size)
        throw new Error('Retry or remove failed attachments before sending.')
    },
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
