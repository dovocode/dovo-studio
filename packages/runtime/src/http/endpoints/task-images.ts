import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileTypeFromBuffer } from 'file-type'
import { constants } from 'node:fs'
import { decode, taskImageRequestSchema, toolImages } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { safeFile, repositoryPath } from '../../scm/repositories/paths.js'
const MAX_BYTES = 16 * 1024 * 1024
function imagePaths(text: string): string[] {
  const root = fromMarkdown(text),
    definitions = new Map(
      root.children.flatMap((node) =>
        node.type === 'definition' ? [[node.identifier, node.url] as const] : [],
      ),
    ),
    paths: string[] = []
  const visit = (node: Nodes) => {
    if (node.type === 'image') paths.push(node.url)
    if (node.type === 'imageReference') {
      const url = definitions.get(node.identifier)
      if (url) paths.push(url)
    }
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(root)
  return paths
}
function localPath(path: string, cwd: string) {
  if (path.startsWith('file:')) return fileURLToPath(path)
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
    throw new HttpError(400, 'Use a local image path')
  try {
    return resolve(cwd, decodeURIComponent(path))
  } catch {
    throw new HttpError(400, 'Invalid image path')
  }
}
async function readImage(s: Services, value: unknown) {
  const input = decode(taskImageRequestSchema, value),
    task = s.store.task(input.taskId)
  if (input.eventId !== undefined) {
    if (input.path !== undefined || input.index === undefined)
      throw new HttpError(400, 'Choose one image source')
    const payload = s.activity.imagePayload(task.id, input.eventId)
    const image = payload === undefined ? undefined : toolImages(payload)[input.index]
    if (!image) throw new HttpError(404, 'This image result is no longer available')
    return { uri: image.uri }
  }
  if (!input.path || input.index !== undefined) throw new HttpError(400, 'Image path is required')
  const cwd = await s.checkouts.directory(task.id),
    filename = localPath(input.path, cwd)
  let authorized = false
  // Images selected by an assistant for this thread may live outside its checkout (screenshots/temp files).
  for (const message of task.messages) {
    if (message.role !== 'assistant') continue
    for (const path of imagePaths(message.text)) {
      try {
        if (localPath(path, cwd) === filename) {
          authorized = true
          break
        }
      } catch {
        /* External image links do not authorize local files. */
      }
    }
    if (authorized) break
  }
  let target: string
  if (authorized) target = await realpath(filename)
  else {
    const path = relative(cwd, filename)
    if (isAbsolute(path) || path === '..' || path.startsWith('..\\') || path.startsWith('../'))
      throw new HttpError(403, 'This image is not shared by the thread')
    target = await safeFile(await repositoryPath(cwd), path)
  }
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
    return { uri: `data:${type.mime};base64,${data.toString('base64')}` }
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
