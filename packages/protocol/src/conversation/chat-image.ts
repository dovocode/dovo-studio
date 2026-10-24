import { ATTACHMENT_IMAGE_MAX_SOURCE_BYTES } from '../shared/attachment-images.js'

/** Resolve server sources on their owning thread, then upload a copy to the active composer. */
export type ChatImageSource =
  | { taskId: string; attachmentId: string }
  | { taskId: string; eventId: string; index: number }
  | { taskId: string; path: string }
  | { uri: string }

export function chatImageData(uri: string) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|heic|heif));base64,([a-z0-9+/]*={0,2})$/i.exec(
    uri,
  )
  if (!match || !match[2]) throw new Error('This image could not be read for editing.')
  if (match[2].length > Math.ceil(ATTACHMENT_IMAGE_MAX_SOURCE_BYTES / 3) * 4)
    throw new Error('Choose an image up to 50 MB to edit.')
  const mime = match[1]!.toLowerCase()
  return { data: match[2], mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.slice(6) }
}

export function chatImageName(label: string, extension: string) {
  const stem = label
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
  return `${stem?.slice(0, 180) || 'chat-image'}.${extension}`
}
