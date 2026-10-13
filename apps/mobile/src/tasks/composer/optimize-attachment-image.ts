import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import {
  ATTACHMENT_IMAGE_TARGET_BYTES,
  ATTACHMENT_IMAGE_MAX_SOURCE_BYTES,
  ATTACHMENT_IMAGE_QUALITY,
  attachmentImageFormat,
  attachmentImageDimensions,
  optimizedAttachmentImageName,
  isAnimatedAttachmentImage,
} from '@dovo/protocol'
import { isHeicAttachment } from './attachment-images'
import type { AttachmentAsset } from './attachment-picker'

export async function optimizeAttachmentImage(asset: AttachmentAsset): Promise<AttachmentAsset> {
  const format = isHeicAttachment(asset)
    ? 'heic'
    : attachmentImageFormat(asset.name, asset.mimeType ?? '')
  if (!format) return asset
  const original = new File(asset.uri)
  if (original.size > ATTACHMENT_IMAGE_MAX_SOURCE_BYTES)
    throw new Error('Choose an image up to 50 MB to optimize.')
  if (
    (format === 'png' || format === 'webp') &&
    isAnimatedAttachmentImage(await original.bytes(), format)
  )
    return asset
  const context = ImageManipulator.manipulate(asset.uri)
  let generated: File | undefined
  try {
    const image = await context.renderAsync()
    let size: { width: number; height: number }
    try {
      size = attachmentImageDimensions(image.width, image.height)
      if (
        format !== 'heic' &&
        original.size <= ATTACHMENT_IMAGE_TARGET_BYTES &&
        size.width === image.width &&
        size.height === image.height
      )
        return asset
    } finally {
      image.release()
    }
    const outputFormat = format === 'jpeg' || format === 'heic' ? 'jpeg' : 'webp'
    while (true) {
      // Always resize from the original, avoiding compounded resampling artifacts.
      context.reset().resize(size)
      const resized = await context.renderAsync()
      try {
        const result = await resized.saveAsync({
          format: outputFormat === 'jpeg' ? SaveFormat.JPEG : SaveFormat.WEBP,
          compress: ATTACHMENT_IMAGE_QUALITY,
        })
        generated = new File(result.uri)
        if (generated.size <= ATTACHMENT_IMAGE_TARGET_BYTES) {
          const prepared = {
            ...asset,
            uri: result.uri,
            name: optimizedAttachmentImageName(asset.name, outputFormat),
            mimeType: `image/${outputFormat}`,
          }
          // The uploader owns cleanup once it receives the optimized file.
          generated = undefined
          return prepared
        }
        const outputBytes = generated.size
        generated.delete()
        generated = undefined
        if (Math.max(size.width, size.height) <= 1)
          throw new Error('Could not reduce this image below the upload limit.')
        const maxSide = Math.max(
          1,
          Math.floor(
            Math.max(size.width, size.height) *
              Math.min(0.85, Math.sqrt(ATTACHMENT_IMAGE_TARGET_BYTES / outputBytes) * 0.9),
          ),
        )
        size = attachmentImageDimensions(size.width, size.height, maxSide)
      } finally {
        resized.release()
      }
    }
  } finally {
    generated?.delete()
    context.release()
  }
}
