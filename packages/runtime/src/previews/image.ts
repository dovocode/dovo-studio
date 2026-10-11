import sharp from 'sharp'
import { HttpError } from '../errors.js'

/** Decode one frame and send only the pixels needed by the preview. Originals remain downloadable. */
export async function imagePreview(data: Buffer, maxSize: number) {
  try {
    const preview = await sharp(data, { limitInputPixels: 32 * 1024 * 1024 })
      .rotate()
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    return { uri: `data:image/webp;base64,${preview.toString('base64')}` }
  } catch (cause) {
    throw new HttpError(
      415,
      `Could not decode image preview: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}
