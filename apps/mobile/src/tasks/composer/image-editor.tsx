import { useEffect, useRef, useState } from 'react'
import { Image } from 'react-native'
import { File } from 'expo-file-system'
import { attachmentImageFormat, isAnimatedAttachmentImage } from '@dovo/protocol'
import { SafeModal } from '../../ui/layout/safe-modal'
import { NativeImageEditor, type EditableImage } from './native-image-editor'
import type { AttachmentAsset } from './attachment-picker'

export function useImageEditor() {
  const [image, setImage] = useState<EditableImage | null>(null)
  const pending = useRef<((asset: AttachmentAsset | null) => void) | null>(null)
  const mounted = useRef(true)
  const finish = (asset: AttachmentAsset | null) => {
    const resolve = pending.current
    pending.current = null
    setImage(null)
    resolve?.(asset)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pending.current?.(null)
      pending.current = null
    }
  }, [])
  const edit = async (asset: AttachmentAsset): Promise<AttachmentAsset | null> => {
    const format = attachmentImageFormat(asset.name, asset.mimeType ?? '')
    if (!format || format === 'heic') return asset
    if (
      (format === 'png' || format === 'webp') &&
      isAnimatedAttachmentImage(await new File(asset.uri).bytes(), format)
    )
      return asset
    if (pending.current) throw new Error('Finish editing the current image first.')
    const { width, height } = await Image.getSize(asset.uri)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
      throw new Error('Could not read this image.')
    if (!mounted.current) return null
    return new Promise((resolve) => {
      pending.current = resolve
      setImage({ asset, width, height })
    })
  }
  return {
    edit,
    editor: image ? (
      <SafeModal visible animationType="slide" onRequestClose={() => finish(null)}>
        <NativeImageEditor image={image} onFinish={finish} />
      </SafeModal>
    ) : null,
  }
}
