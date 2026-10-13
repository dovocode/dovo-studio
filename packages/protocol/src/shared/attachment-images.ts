// Leave room for base64 within providers' 5 MB encoded-image limit.
export const ATTACHMENT_IMAGE_TARGET_BYTES = 3_750_000
export const ATTACHMENT_IMAGE_MAX_SIDE = 2048
// This is a local source-file bound, before resizing, not an upload limit.
export const ATTACHMENT_IMAGE_MAX_SOURCE_BYTES = 50 * 1024 * 1024
export const ATTACHMENT_IMAGE_QUALITY = 0.85

export function attachmentImageFormat(name: string, mime: string) {
  if (/^image\/gif$/i.test(mime) || /\.gif$/i.test(name)) return undefined
  if (/^image\/hei[cf](?:-sequence)?$/i.test(mime) || /\.(heic|heif)$/i.test(name)) return 'heic'
  if (/^image\/png$/i.test(mime) || /\.png$/i.test(name)) return 'png'
  if (/^image\/webp$/i.test(mime) || /\.webp$/i.test(name)) return 'webp'
  if (/^image\/jpeg$/i.test(mime) || /\.jpe?g$/i.test(name)) return 'jpeg'
  return undefined
}

export function attachmentImageDimensions(
  width: number,
  height: number,
  maxSide = ATTACHMENT_IMAGE_MAX_SIDE,
) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('Could not read image dimensions')
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function optimizedAttachmentImageName(name: string, format: 'jpeg' | 'webp' | 'png') {
  return `${name.replace(/\.[^.]+$/, '') || 'photo'}.${format === 'jpeg' ? 'jpg' : format}`
}

/** Keep animated PNG and WebP files intact instead of silently retaining only one frame. */
export function isAnimatedAttachmentImage(bytes: Uint8Array, format: string) {
  if (format === 'webp')
    return (
      bytes.length > 20 &&
      String.fromCharCode(...bytes.subarray(12, 16)) === 'VP8X' &&
      !!(bytes[20]! & 2)
    )
  if (format !== 'png') return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const chunk = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (chunk === 'acTL') return true
    if (chunk === 'IDAT' || chunk === 'IEND') return false
    offset += view.getUint32(offset) + 12
  }
  return false
}
