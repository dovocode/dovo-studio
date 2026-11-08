import type { FileHandle } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { HttpError } from '../../errors.js'

export const DEFAULT_FILE_PREVIEW_BYTES = 256 * 1024
export const MAX_FILE_PREVIEW_BYTES = 1024 * 1024
const MAX_FILE_BYTES = 100 * 1024 * 1024
const SCAN_BYTES = 64 * 1024

export async function readBoundedFile(
  handle: FileHandle,
  path: string,
  preview: { startLine?: number; maxBytes?: number },
) {
  const startLine = preview.startLine ?? 1
  const maxBytes = preview.maxBytes ?? DEFAULT_FILE_PREVIEW_BYTES
  if (!Number.isSafeInteger(startLine) || startLine < 1)
    throw new HttpError(400, 'Start line must be a positive integer')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_PREVIEW_BYTES)
    throw new HttpError(400, 'Invalid file preview size')
  const before = await handle.stat()
  if (!before.isFile()) throw new HttpError(400, 'Choose a regular file')
  if (before.size > MAX_FILE_BYTES)
    throw new HttpError(413, 'Only text files up to 100 MB can be previewed')

  let position = 0
  let line = 1
  const scan = Buffer.alloc(SCAN_BYTES)
  while (line < startLine && position < before.size) {
    const { bytesRead } = await handle.read(
      scan,
      0,
      Math.min(scan.length, before.size - position),
      position,
    )
    if (!bytesRead) break
    const chunk = scan.subarray(0, bytesRead)
    if (chunk.includes(0)) throw new HttpError(415, 'Binary files cannot be previewed')
    let index = 0
    while (line < startLine) {
      const newline = chunk.indexOf(10, index)
      if (newline === -1) break
      line++
      index = newline + 1
    }
    position += line === startLine ? index : bytesRead
  }
  const buffer = Buffer.alloc(Math.min(maxBytes, before.size - position))
  let total = 0
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(buffer, total, buffer.length - total, position + total)
    if (!bytesRead) break
    total += bytesRead
  }
  const bytes = buffer.subarray(0, total)
  if (bytes.includes(0)) throw new HttpError(415, 'Binary files cannot be previewed')
  const after = await handle.stat()
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || total !== buffer.length)
    throw new HttpError(409, 'File changed while it was being read. Retry the preview.')
  const complete = position === 0 && total === before.size
  const decoder = new StringDecoder('utf8')
  const contents =
    complete || position + total === before.size ? decoder.end(bytes) : decoder.write(bytes)
  return {
    path,
    contents,
    size: before.size,
    complete,
    truncated: !complete,
    startLine: line,
    hasMore: position + total < before.size,
  }
}
