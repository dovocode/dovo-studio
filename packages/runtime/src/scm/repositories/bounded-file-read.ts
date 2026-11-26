import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { HttpError } from '../../errors.js'
import { MAX_RTF_BYTES, parseRtf } from './rtf-preview.js'

export const DEFAULT_FILE_PREVIEW_BYTES = 256 * 1024
export const MAX_FILE_PREVIEW_BYTES = 1024 * 1024
const MAX_FILE_BYTES = 100 * 1024 * 1024
const SCAN_BYTES = 64 * 1024
const cursorPattern = /^([\da-f]{64})\.(\d{1,9})\.(\d{1,9})(\.gb18030)?$/

function decodeTextPage(bytes: Buffer, hasMore: boolean, legacy: boolean) {
  const encodings = legacy ? (['gb18030'] as const) : (['utf-8', 'gb18030'] as const)
  for (const encoding of encodings) {
    const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true })
    let contents: string
    try {
      contents = decoder.decode(bytes, { stream: hasMore })
    } catch {
      continue
    }
    try {
      decoder.decode()
      return { contents, consumed: bytes.length, legacy: encoding === 'gb18030' }
    } catch {
      // The page ended inside a character. UTF-8 and GB18030 have at most four bytes per character.
      for (let consumed = bytes.length - 1; consumed >= Math.max(0, bytes.length - 3); consumed--)
        try {
          decoder.decode(bytes.subarray(0, consumed))
          return { contents, consumed, legacy: encoding === 'gb18030' }
        } catch {
          // Continue back to the last complete character.
        }
    }
  }
}

function fileRevision(stat: BigIntStats) {
  return createHash('sha256')
    .update([stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':'))
    .digest('hex')
}

async function readWindow(
  handle: FileHandle,
  before: BigIntStats,
  position: number,
  length: number,
) {
  const buffer = Buffer.alloc(length)
  let total = 0
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(buffer, total, buffer.length - total, position + total)
    if (!bytesRead) break
    total += bytesRead
  }
  const after = await handle.stat({ bigint: true })
  if (total !== buffer.length || fileRevision(after) !== fileRevision(before))
    throw new HttpError(409, 'File changed while it was being read. Retry the preview.')
  return buffer
}

export async function readRtfFile(handle: FileHandle, path: string) {
  if (!/\.rtf$/i.test(path)) throw new HttpError(400, 'Choose an RTF file')
  const before = await handle.stat({ bigint: true })
  if (!before.isFile()) throw new HttpError(400, 'Choose a regular file')
  if (before.size > MAX_RTF_BYTES)
    throw new HttpError(413, 'RTF previews support files up to 8 MB.')
  const size = Number(before.size)
  const bytes = await readWindow(handle, before, 0, size)
  return { path, contents: '', size, document: parseRtf(bytes) }
}

export async function readBoundedFile(
  handle: FileHandle,
  path: string,
  preview: { startLine?: number; maxBytes?: number; cursor?: string },
) {
  const startLine = preview.startLine ?? 1
  const maxBytes = preview.maxBytes ?? DEFAULT_FILE_PREVIEW_BYTES
  if (!Number.isSafeInteger(startLine) || startLine < 1)
    throw new HttpError(400, 'Start line must be a positive integer')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_PREVIEW_BYTES)
    throw new HttpError(400, 'Invalid file preview size')
  const cursor = preview.cursor === undefined ? undefined : cursorPattern.exec(preview.cursor)
  if (cursor === null || (cursor && (preview.startLine !== undefined || maxBytes < 4)))
    throw new HttpError(400, 'Invalid file preview cursor')
  const before = await handle.stat({ bigint: true })
  if (!before.isFile()) throw new HttpError(400, 'Choose a regular file')
  if (before.size > MAX_FILE_BYTES)
    throw new HttpError(413, 'Only text files up to 100 MB can be previewed')

  const size = Number(before.size)
  const revision = fileRevision(before)
  if (cursor && cursor[1] !== revision)
    throw new HttpError(409, 'File changed on disk. Reload the preview from the beginning.')
  let position = cursor ? Number(cursor[2]) : 0
  let line = cursor ? Number(cursor[3]) : 1
  if (position > size || line < 1 || line > position + 1)
    throw new HttpError(400, 'Invalid file preview cursor')
  const scan = startLine > 1 ? Buffer.alloc(SCAN_BYTES) : undefined
  while (scan && line < startLine && position < size) {
    const { bytesRead } = await handle.read(
      scan,
      0,
      Math.min(scan.length, size - position),
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
  const bytes = await readWindow(handle, before, position, Math.min(maxBytes, size - position))
  const total = bytes.length
  if (bytes.includes(0)) throw new HttpError(415, 'Binary files cannot be previewed')
  const complete = position === 0 && total === size
  const hasMore = position + total < size
  const decoded = decodeTextPage(bytes, hasMore, !!cursor?.[4])
  if (!decoded && cursor?.[4]) throw new HttpError(415, 'Invalid GB18030 text')
  let contents = decoded?.contents ?? ''
  let consumed = decoded?.consumed ?? total
  if (!decoded) {
    const decoder = new StringDecoder('utf8')
    contents = hasMore ? decoder.write(bytes) : decoder.end(bytes)
    if (hasMore && decoder.end()) {
      // Read the buffered UTF-8 prefix again on the next page.
      do {
        consumed--
      } while ((bytes[consumed]! & 0xc0) === 0x80)
    }
  }
  const nextLine = line + (contents.match(/\n/g)?.length ?? 0)
  const suffix = decoded?.legacy ? '.gb18030' : ''
  return {
    path,
    contents,
    size,
    complete,
    truncated: !complete,
    startLine: line,
    hasMore,
    encoding: decoded?.legacy ? ('gb18030' as const) : undefined,
    cursor: maxBytes >= 4 ? `${revision}.${position}.${line}${suffix}` : undefined,
    nextCursor:
      hasMore && maxBytes >= 4
        ? `${revision}.${position + consumed}.${nextLine}${suffix}`
        : undefined,
  }
}
