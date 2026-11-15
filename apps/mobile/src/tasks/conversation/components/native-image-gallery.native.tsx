import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { Directory, File, Paths } from 'expo-file-system'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Platform, type ViewProps } from 'react-native'
import { randomUUID, attachmentReadSchema, isImageAttachment } from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../../../runtime/connection/provider'
import type { NativeImageGalleryProps } from './native-image-gallery.types'

type ImageItem = { id: string; name: string; uri?: string; error?: string }
type GalleryViewProps = ViewProps & {
  images: ImageItem[]
  selectedID: string
  editable: boolean
  labels: Record<string, string>
  onClose: () => void
  onSelect: (event: { nativeEvent: { id: string } }) => void
  onEdit: (event: { nativeEvent: { id: string } }) => void
  onRetry: (event: { nativeEvent: { id: string } }) => void
}
const available = Platform.OS === 'ios' && requireOptionalNativeModule('DovoImageGallery')
const GalleryView: ComponentType<GalleryViewProps> | null = available
  ? requireNativeView('DovoImageGallery')
  : null
const retentionMs = 24 * 60 * 60 * 1000

function Gallery({ taskId, files, initial, onClose, onEdit }: NativeImageGalleryProps) {
  const uiText = useInterfaceText()
  const { callEffect } = useRuntime()
  const [selectedID, setSelectedID] = useState(initial.attachment.id)
  const [cacheVersion, setCacheVersion] = useState(0)
  const [items, setItems] = useState<ImageItem[]>(() =>
    files.filter(isImageAttachment).map(({ id, name }) => ({ id, name })),
  )
  const owner = useRef<{ directory: Directory; active: boolean; pending: Set<string> } | null>(null)
  useEffect(() => {
    try {
      const root = new Directory(Paths.cache, 'image-gallery')
      root.create({ intermediates: true, idempotent: true })
      // Exports remain readable while a system share extension uses them.
      for (const entry of root.list()) {
        if (!(entry instanceof Directory)) continue
        const modified = entry.info().modificationTime
        if (modified != null && Date.now() - modified > retentionMs) {
          try {
            entry.delete()
          } catch (error) {
            console.warn('Could not prune image preview', error)
          }
        }
      }
      const directory = new Directory(root, randomUUID())
      directory.create()
      const current = { directory, active: true, pending: new Set<string>() }
      owner.current = current
      setItems((images) => images.map((image) => ({ ...image, error: undefined })))
      return () => {
        current.active = false
        owner.current = null
      }
    } catch (error) {
      setItems((images) => images.map((image) => ({ ...image, error: String(error) })))
    }
  }, [cacheVersion])
  const load = (id: string, retry = false) => {
    const current = owner.current
    if (!current?.active || current.pending.has(id)) return
    const item = items.find((image) => image.id === id)
    if (!item || (item.uri && !retry)) return
    current.pending.add(id)
    if (retry)
      setItems((images) =>
        images.map((image) =>
          image.id === id ? { ...image, uri: undefined, error: undefined } : image,
        ),
      )
    void (async () => {
      try {
        const result =
          id === initial.attachment.id && !retry
            ? initial
            : await runClientEffect(
                callEffect('/api/attachments/read', { taskId, id }, attachmentReadSchema),
              )
        if (!current.active) return
        if (result.attachment.id !== id) throw new Error('Image identity does not match')
        // A new URI also invalidates a failed native decode of the previous file.
        const folder = new Directory(current.directory, id, randomUUID())
        folder.create({ intermediates: true })
        const name =
          result.attachment.name.replace(/[/\\]|\p{Cc}/gu, '_').replace(/^\.+$/, '_') || 'image'
        const file = new File(folder, name)
        await file.write(result.data, { encoding: 'base64' })
        if (current.active)
          setItems((images) =>
            images.map((image) =>
              image.id === id ? { ...image, uri: file.uri, error: undefined } : image,
            ),
          )
      } catch (error) {
        if (current.active)
          setItems((images) =>
            images.map((image) => (image.id === id ? { ...image, error: String(error) } : image)),
          )
      } finally {
        current.pending.delete(id)
      }
    })()
  }
  useEffect(() => {
    const index = items.findIndex((image) => image.id === selectedID)
    for (const item of items.slice(Math.max(0, index - 1), index + 2))
      if (!item.uri && !item.error) load(item.id)
  }, [selectedID, items])
  if (!GalleryView) return null
  return (
    <GalleryView
      style={{ flex: 1 }}
      images={items}
      selectedID={selectedID}
      editable={!!onEdit}
      labels={{
        close: uiText('Close preview'),
        share: uiText('Share file'),
        save: uiText('Save'),
        edit: uiText('Edit'),
        retry: uiText('Retry'),
      }}
      onClose={onClose}
      onSelect={({ nativeEvent }) => setSelectedID(nativeEvent.id)}
      onEdit={({ nativeEvent }) => {
        onClose()
        onEdit?.(nativeEvent.id)
      }}
      onRetry={({ nativeEvent }) => {
        if (!owner.current) setCacheVersion((version) => version + 1)
        else load(nativeEvent.id, true)
      }}
    />
  )
}
export const NativeImageGallery: ComponentType<NativeImageGalleryProps> | null = GalleryView
  ? Gallery
  : null
