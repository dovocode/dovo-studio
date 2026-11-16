import { createHash } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { MAX_ATTACHMENT_BYTES, type PullReviewImage } from '@dovo/protocol'
import { HttpError } from '../../errors.js'

/** Validate bytes on the owning computer. Never trust browser MIME metadata. */
export async function pullReviewImages(images: readonly PullReviewImage[]) {
  let total = 0
  return Promise.all(
    images.map(async (image, index) => {
      if (image.data.length % 4 || /[^A-Za-z0-9+/=]/.test(image.data))
        throw new HttpError(400, 'Invalid review image encoding.')
      const bytes = Buffer.from(image.data, 'base64')
      if (bytes.toString('base64') !== image.data)
        throw new HttpError(400, 'Invalid review image encoding.')
      total += bytes.length
      if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || total > 10 * 1024 * 1024)
        throw new HttpError(400, 'Use images up to 5 MB each and 10 MB in total.')
      const type = await fileTypeFromBuffer(bytes)
      if (!type || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type.mime))
        throw new HttpError(400, 'Use PNG, JPEG, WebP or GIF review images.')
      return {
        id: `image-${index + 1}`,
        name: image.name,
        mime: type.mime,
        size: bytes.length,
        digest: createHash('sha256').update(bytes).digest('hex'),
        data: image.data,
      }
    }),
  )
}
