import {
  ATTACHMENT_ARCHIVE_MAX_ENTRIES,
  ATTACHMENT_ARCHIVE_MAX_EXPANDED_BYTES,
  MAX_ATTACHMENT_BYTES,
  isZipAttachment,
  type AttachmentArchiveEntry,
} from '@dovo/protocol'
import { Open, type CentralDirectory } from 'unzipper'
import { crc32 } from 'node:zlib'
import { fileTypeFromBuffer } from 'file-type'
import { HttpError } from '../errors.js'
import type { Attachments } from './attachments.js'

const ratioLimit = (compressed: number) => Math.max(1024 * 1024, compressed * 200)
const invalid = () =>
  new HttpError(400, 'This ZIP cannot be browsed. Share it to open in another app.')

/** Bound directory allocation before the ZIP library parses records. No archive paths reach disk. */
function boundedDirectory(data: Buffer) {
  if (data.length > MAX_ATTACHMENT_BYTES)
    throw new HttpError(413, 'ZIP attachments must be 5 MB or smaller')
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset--) {
    if (data.readUInt32LE(offset) !== 0x06054b50) continue
    const comment = data.readUInt16LE(offset + 20)
    if (offset + 22 + comment !== data.length) continue
    const count = data.readUInt16LE(offset + 10)
    if (count > ATTACHMENT_ARCHIVE_MAX_ENTRIES)
      throw new HttpError(413, 'ZIP preview supports up to 512 entries. Share the ZIP instead.')
    if (
      data.readUInt16LE(offset + 4) !== 0 ||
      data.readUInt16LE(offset + 6) !== 0 ||
      data.readUInt16LE(offset + 8) !== count ||
      data.readUInt32LE(offset + 16) + data.readUInt32LE(offset + 12) !== offset
    )
      throw invalid()
    // unzipper's default tail search is short. Remove only the optional comment so long-comment
    // archives use the same bounded parser without depending on an untyped library option.
    const normalized = Buffer.from(data.subarray(0, offset + 22))
    normalized.writeUInt16LE(0, offset + 20)
    return normalized
  }
  throw invalid()
}

function safePath(path: string, directory: boolean) {
  const trimmed = directory ? path.replace(/\/$/, '') : path
  const parts = trimmed.split('/')
  const controls = path
    .split('')
    .some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !/[\\:]/.test(path) &&
    !controls &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
    (directory || parts.at(-1)!.length <= 250)
  )
}

async function openArchive(attachments: Pick<Attachments, 'read'>, taskId: string, id: string) {
  const source = attachments.read(taskId, id)
  if (!isZipAttachment(source.attachment)) throw invalid()
  const data = Buffer.from(source.data, 'base64')
  const normalized = boundedDirectory(data)
  let directory: CentralDirectory
  try {
    directory = await Open.buffer(normalized)
  } catch {
    throw invalid()
  }
  let total = 0
  const paths = new Set<string>()
  for (const entry of directory.files) {
    const folder = entry.type === 'Directory'
    const key = entry.path.replace(/\/$/, '')
    const mode = (entry.externalFileAttributes >>> 16) & 0xf000
    if (
      entry.signature !== 0x02014b50 ||
      !safePath(entry.path, folder) ||
      paths.has(key) ||
      (mode !== 0 && mode !== (folder ? 0x4000 : 0x8000)) ||
      (entry.flags & 1) !== 0 ||
      ![0, 8].includes(entry.compressionMethod) ||
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0 ||
      entry.offsetToLocalFileHeader < 0 ||
      entry.offsetToLocalFileHeader + 30 + entry.compressedSize > normalized.length
    )
      throw invalid()
    paths.add(key)
    total += entry.uncompressedSize
    if (
      entry.uncompressedSize > MAX_ATTACHMENT_BYTES ||
      entry.uncompressedSize > ratioLimit(entry.compressedSize) ||
      total > ATTACHMENT_ARCHIVE_MAX_EXPANDED_BYTES ||
      total > ratioLimit(data.length)
    )
      throw new HttpError(413, 'The expanded ZIP exceeds preview limits. Share the ZIP instead.')
  }
  // An implied parent must not also name a file ("folder" and "folder/child.txt").
  const files = new Set(
    directory.files.filter((entry) => entry.type === 'File').map((entry) => entry.path),
  )
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++)
      if (files.has(parts.slice(0, i).join('/'))) throw invalid()
  }
  return directory.files
}

export async function listAttachmentArchive(
  attachments: Pick<Attachments, 'read'>,
  input: { taskId: string; id: string },
) {
  const files = await openArchive(attachments, input.taskId, input.id)
  const entries: AttachmentArchiveEntry[] = files.map((entry) => ({
    path: entry.path,
    directory: entry.type === 'Directory',
    size: entry.uncompressedSize,
  }))
  return { entries }
}

export async function readAttachmentArchive(
  attachments: Pick<Attachments, 'read'>,
  input: { taskId: string; id: string; path: string },
) {
  const files = await openArchive(attachments, input.taskId, input.id)
  const entry = files.find((file) => file.path === input.path && file.type === 'File')
  if (!entry) throw new HttpError(404, 'ZIP entry not found')
  const chunks: Buffer[] = []
  let size = 0
  let checksum = 0
  const stream = entry.stream()
  try {
    for await (const value of stream) {
      if (!Buffer.isBuffer(value)) throw invalid()
      size += value.length
      if (size > entry.uncompressedSize || size > MAX_ATTACHMENT_BYTES)
        throw new HttpError(413, 'The expanded file exceeds preview limits. Share the ZIP instead.')
      checksum = crc32(value, checksum)
      chunks.push(value)
    }
    if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw invalid()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw invalid()
  } finally {
    stream.destroy()
  }
  const data = Buffer.concat(chunks, size)
  const detected = await fileTypeFromBuffer(data).catch((error) => {
    if (error instanceof Error && error.name === 'EndOfStreamError') return undefined
    throw error
  })
  let mime = detected?.mime ?? 'application/octet-stream'
  if (!detected) {
    try {
      if (!new TextDecoder('utf-8', { fatal: true }).decode(data).includes('\0'))
        mime = 'text/plain'
    } catch {
      // Binary entries retain the external-sharing fallback.
    }
  }
  return {
    path: entry.path,
    name: entry.path.split('/').at(-1)!,
    mime,
    size,
    data: data.toString('base64'),
  }
}
