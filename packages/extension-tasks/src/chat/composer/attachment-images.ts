import {
  ATTACHMENT_IMAGE_TARGET_BYTES,
  ATTACHMENT_IMAGE_MAX_SOURCE_BYTES,
  ATTACHMENT_IMAGE_QUALITY,
  attachmentImageFormat,
  attachmentImageDimensions,
  optimizedAttachmentImageName,
  isAnimatedAttachmentImage,
} from '@dovo/protocol'

/** Optimize locally so oversized camera photos never need to cross the runtime connection. */
export async function optimizeAttachmentImage(file: File): Promise<File> {
  const format = attachmentImageFormat(file.name, file.type)
  if (!format) return file
  if (file.size > ATTACHMENT_IMAGE_MAX_SOURCE_BYTES)
    throw new Error('Choose an image up to 50 MB to optimize.')
  if (
    (format === 'png' || format === 'webp') &&
    isAnimatedAttachmentImage(new Uint8Array(await file.arrayBuffer()), format)
  )
    return file
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    image.src = url
    try {
      await image.decode()
    } catch {
      throw new Error('Could not decode this image. Try exporting it as PNG or JPEG.')
    }
    let size = attachmentImageDimensions(image.naturalWidth, image.naturalHeight)
    if (
      format !== 'heic' &&
      file.size <= ATTACHMENT_IMAGE_TARGET_BYTES &&
      size.width === image.naturalWidth &&
      size.height === image.naturalHeight
    )
      return file
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image optimization is unavailable in this browser.')
    // WebP retains PNG/WebP transparency; JPEG remains JPEG.
    const outputFormat = format === 'jpeg' || format === 'heic' ? 'jpeg' : 'webp'
    while (true) {
      canvas.width = size.width
      canvas.height = size.height
      context.drawImage(image, 0, 0, size.width, size.height)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Could not encode this image.'))),
          `image/${outputFormat}`,
          ATTACHMENT_IMAGE_QUALITY,
        )
      })
      if (blob.size <= ATTACHMENT_IMAGE_TARGET_BYTES) {
        // Browsers may fall back to PNG when an encoder is unavailable.
        const extension = blob.type === 'image/png' ? 'png' : outputFormat
        return new File([blob], optimizedAttachmentImageName(file.name, extension), {
          type: blob.type,
          lastModified: file.lastModified,
        })
      }
      if (Math.max(size.width, size.height) <= 1)
        throw new Error('Could not reduce this image below the upload limit.')
      const maxSide = Math.max(
        1,
        Math.floor(
          Math.max(size.width, size.height) *
            Math.min(0.85, Math.sqrt(ATTACHMENT_IMAGE_TARGET_BYTES / blob.size) * 0.9),
        ),
      )
      size = attachmentImageDimensions(size.width, size.height, maxSide)
    }
  } finally {
    image.src = ''
    URL.revokeObjectURL(url)
  }
}
