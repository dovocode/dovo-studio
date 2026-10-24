import { useEffect, useRef, useState, type ReactNode } from 'react'
import { File, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { Alert } from 'react-native'
import { fetch } from 'expo/fetch'
import { runClientEffect } from '@dovo/client-runtime'
import {
  attachmentReadSchema,
  taskImageReadSchema,
  chatImageData,
  chatImageName,
  ATTACHMENT_IMAGE_MAX_SOURCE_BYTES,
  type ChatImageSource,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { ChatImageEditContext } from './chat-image-edit-context'
import type { AttachmentAsset } from './attachment-picker'

export function ChatImageEditProvider({
  children,
  upload,
  disabled,
  busy,
  onBusy,
}: {
  children: ReactNode
  upload: (assets: AttachmentAsset[], editChatImage?: boolean) => Promise<void>
  disabled: boolean
  busy: boolean
  onBusy: (busy: boolean) => void
}) {
  const { readEffect, connected, connection } = useRuntime()
  const [working, setWorking] = useState(false)
  const locked = useRef(false)
  const current = useRef(true)
  useEffect(() => {
    current.current = true
    return () => {
      current.current = false
    }
  }, [])
  const identity = JSON.stringify([connection?.address, connection?.token])
  const route = useRef(identity)
  route.current = identity
  const edit = async (source: ChatImageSource, label: string) => {
    if (locked.current || busy || disabled) return
    locked.current = true
    setWorking(true)
    onBusy(true)
    let file: File | undefined
    try {
      if (!connected) throw new Error('Reconnect to edit and attach images.')
      let uri: string
      if ('uri' in source) uri = source.uri
      else if ('attachmentId' in source) {
        const result = await runClientEffect(
          readEffect(
            '/api/attachments/read',
            { taskId: source.taskId, id: source.attachmentId },
            attachmentReadSchema,
          ),
        )
        uri = `data:${result.attachment.mime};base64,${result.data}`
      } else
        uri = (
          await runClientEffect(readEffect('/api/tasks/images/read', source, taskImageReadSchema))
        ).uri
      let name: string
      let mime: string
      file = new File(Paths.cache, `chat-edit-${randomUUID()}`)
      if (uri.startsWith('data:')) {
        const data = chatImageData(uri)
        name = chatImageName(label, data.extension)
        mime = data.mime
        await file.write(data.data, { encoding: 'base64' })
      } else {
        if (!/^https?:\/\//i.test(uri)) throw new Error('This image URL cannot be edited.')
        const response = await fetch(uri, { credentials: 'omit' })
        if (!response.ok) throw new Error('Could not download this image for editing.')
        if (Number(response.headers.get('content-length')) > ATTACHMENT_IMAGE_MAX_SOURCE_BYTES)
          throw new Error('Choose an image up to 50 MB to edit.')
        const blob = await response.blob()
        if (blob.size > ATTACHMENT_IMAGE_MAX_SOURCE_BYTES)
          throw new Error('Choose an image up to 50 MB to edit.')
        mime = blob.type.split(';')[0] ?? ''
        if (!/^image\/(png|jpeg|webp|gif|heic|heif)$/.test(mime))
          throw new Error('This image format cannot be edited.')
        await file.write(new Uint8Array(await blob.arrayBuffer()))
        name = chatImageName(label, mime === 'image/jpeg' ? 'jpg' : mime.slice(6))
      }
      if (current.current && route.current === identity)
        await upload([{ uri: file.uri, name, mimeType: mime }], true)
    } catch (cause) {
      if (current.current)
        Alert.alert('Couldn’t attach image', cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (file?.exists) file.delete()
      locked.current = false
      if (current.current) {
        setWorking(false)
        onBusy(false)
      }
    }
  }
  return (
    <ChatImageEditContext value={{ edit, busy: busy || working, disabled }}>
      {children}
    </ChatImageEditContext>
  )
}
