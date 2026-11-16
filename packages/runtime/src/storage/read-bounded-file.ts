import type { FileHandle } from 'node:fs/promises'
import { HttpError } from '../errors.js'

/** Read one extra byte to enforce the limit even when a file grows after stat. */
export async function readBoundedFile(handle: FileHandle, limit: number) {
  const buffer = Buffer.alloc(limit + 1)
  let length = 0
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
    if (!bytesRead) break
    length += bytesRead
  }
  if (length > limit) throw new HttpError(413, `File exceeds ${limit} bytes`)
  return buffer.subarray(0, length)
}
