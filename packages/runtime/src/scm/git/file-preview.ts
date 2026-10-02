import type { FilePreview, FilePreviewMetadata } from '@dovo/protocol'

const TEXT_LIMIT = 64 * 1024
const IMAGE_LIMIT = 16 * 1024 * 1024
/** Preview bytes are requested only when a file is opened; the Git snapshot remains complete. */
export async function createFilePreview(
  path: string,
  metadata: Pick<FilePreviewMetadata, 'before' | 'after'>,
  read: (hash: string, limit: number) => Promise<Buffer>,
): Promise<FilePreview> {
  const side = async (file: FilePreviewMetadata['before']): Promise<FilePreview['before']> => {
    if (!file) return undefined
    if (file.mode === '160000')
      return { kind: 'submodule', size: file.size, text: file.hash, truncated: false }
    const image = /\.(png|jpe?g|webp|gif|avif|tiff?|heic|ico)$/i.test(path)
    if (image && file.mode !== '120000') {
      if (file.size > IMAGE_LIMIT)
        return {
          kind: 'binary',
          size: file.size,
          truncated: false,
          notice: 'Image saved in full. It exceeds the thumbnail decoder’s 16 MB input limit.',
        }
      const bytes = await read(file.hash, IMAGE_LIMIT)
      try {
        const sharp = (await import('sharp')).default
        const thumbnail = await sharp(bytes, { limitInputPixels: 40 * 1024 * 1024 })
          .rotate()
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .png({ palette: true, quality: 75 })
          .toBuffer()
        if (thumbnail.length <= 192 * 1024)
          return {
            kind: 'image',
            size: file.size,
            image: `data:image/png;base64,${thumbnail.toString('base64')}`,
            truncated: false,
          }
        return {
          kind: 'binary',
          size: file.size,
          truncated: false,
          notice: 'Image saved in full. A compact thumbnail could not be generated.',
        }
      } catch (error) {
        return {
          kind: 'binary',
          size: file.size,
          truncated: false,
          notice: `Image saved in full. Thumbnail unavailable: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }
    const bytes = await read(file.hash, TEXT_LIMIT)
    if (bytes.includes(0)) return { kind: 'binary', size: file.size, truncated: false }
    // Streaming decoding keeps a UTF-8 character cut at the prefix boundary out of the preview.
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, {
        stream: bytes.length < file.size,
      })
      return { kind: 'text', size: file.size, text, truncated: bytes.length < file.size }
    } catch {
      return { kind: 'binary', size: file.size, truncated: false }
    }
  }
  const [before, after] = await Promise.all([side(metadata.before), side(metadata.after)])
  return { before, after }
}
