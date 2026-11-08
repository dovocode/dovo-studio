import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { HttpError } from '../../../errors.js'

/** Discovery reads only a bounded header; the full file is read only after selection. */
export async function readPiSessionFile(path: string, mode: 'header' | 'transcript') {
  const header = mode === 'header'
  const limit = header ? 64 * 1024 : 16 * 1024 * 1024
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new HttpError(409, 'The Pi transcript is not a regular file')
    if (!header && info.size > limit)
      throw new HttpError(413, 'This Pi transcript exceeds the 16 MiB import limit')
    const buffer = Buffer.alloc(Math.min(info.size + 1, limit))
    let bytesRead = 0
    let newline = -1
    while (bytesRead < buffer.length) {
      const length = header ? Math.min(1024, buffer.length - bytesRead) : buffer.length - bytesRead
      const chunk = await file.read(buffer, bytesRead, length, bytesRead)
      if (!chunk.bytesRead) break
      if (header) newline = buffer.indexOf(10, bytesRead)
      bytesRead += chunk.bytesRead
      if (header && newline >= 0 && newline < bytesRead) break
    }
    const after = await file.stat()
    if (!header && (after.size !== info.size || after.mtimeMs !== info.mtimeMs))
      throw new HttpError(409, 'The Pi transcript changed. Close Pi and preview it again')
    const end = header && newline >= 0 ? newline : bytesRead
    return {
      text: header && newline < 0 && after.size > bytesRead ? '' : buffer.toString('utf8', 0, end),
      info: after,
    }
  } finally {
    await file.close()
  }
}
