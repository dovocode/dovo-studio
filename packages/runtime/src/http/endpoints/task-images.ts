import { open } from 'node:fs/promises'
import { fileTypeFromBuffer } from 'file-type'
import { constants } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import {
  decode,
  taskImageRequestSchema,
  toolImages,
  nativeToolImagePath,
  isImageAttachment,
} from '@dovo/protocol'
import { imagePreview } from '../../previews/image.js'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { sharedTaskFile } from './task-files.js'
const MAX_BYTES = 16 * 1024 * 1024
async function readImage(s: Services, value: unknown) {
  const input = decode(taskImageRequestSchema, value),
    task = s.store.taskSummary(input.taskId)
  if (input.attachmentId !== undefined) {
    if (input.path !== undefined || input.eventId !== undefined || input.index !== undefined)
      throw new HttpError(400, 'Choose one image source')
    const attachment = s.attachments.read(task.id, input.attachmentId)
    if (!isImageAttachment(attachment.attachment))
      throw new HttpError(415, 'Choose an image attachment')
    return imagePreview(Buffer.from(attachment.data, 'base64'), input.maxSize ?? 1024)
  }
  if (input.eventId !== undefined) {
    if (input.path !== undefined || input.index === undefined)
      throw new HttpError(400, 'Choose one image source')
    const payload = s.activity.imagePayload(task.id, input.eventId)
    const image = payload === undefined ? undefined : toolImages(payload)[input.index]
    if (image)
      return input.maxSize
        ? imagePreview(
            Buffer.from(image.uri.slice(image.uri.indexOf(',') + 1), 'base64'),
            input.maxSize,
          )
        : { uri: image.uri }
    const path = input.index === 0 ? nativeToolImagePath(payload) : undefined
    if (!path) throw new HttpError(404, 'This image result is no longer available')
    // The saved, task-owned event authorizes this exact provider output, including
    // generated images outside the checkout. A client-supplied path still uses sharedTaskFile.
    const target = isAbsolute(path) ? path : resolve(await s.checkouts.fileDirectory(task.id), path)
    return readImageFile(target, input.maxSize)
  }
  if (!input.path || input.index !== undefined) throw new HttpError(400, 'Image path is required')
  const target = await sharedTaskFile(s, task.id, input.path)
  return readImageFile(target, input.maxSize)
}
async function readImageFile(target: string, maxSize?: number) {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_BYTES)
      throw new HttpError(413, 'Image previews support files up to 16 MB')
    const buffer = Buffer.alloc(info.size + 1),
      bytesRead = await readBounded(handle, buffer)
    if (bytesRead > info.size) throw new HttpError(409, 'Image changed while loading; retry')
    const data = buffer.subarray(0, bytesRead),
      type = await fileTypeFromBuffer(data)
    if (!type || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type.mime))
      throw new HttpError(415, 'Use a PNG, JPEG, GIF or WebP image')
    return maxSize
      ? imagePreview(data, maxSize)
      : { uri: `data:${type.mime};base64,${data.toString('base64')}` }
  } finally {
    await handle.close()
  }
}

async function readBounded(handle: Awaited<ReturnType<typeof open>>, buffer: Buffer) {
  let total = 0
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
    if (!bytesRead) break
    total += bytesRead
  }
  return total
}
export async function readTaskImage(s: Services, value: unknown) {
  try {
    return await readImage(s, value)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR'].includes(String(error.code))
    )
      throw new HttpError(404, 'This image file is no longer available')
    throw error
  }
}
