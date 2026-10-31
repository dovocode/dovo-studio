import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { relative } from 'node:path'
import { HttpError } from '../../errors.js'
import { safeFile } from './paths.js'

/** Resolve a contained alias without changing safeFile's lexical-path contract. */
export async function canonicalPreviewFile(root: string, path: string) {
  const target = await realpath(await safeFile(root, path))
  // Recheck containment after resolution, including a link swapped during safeFile.
  const validated = await safeFile(root, relative(root, target))
  if ((await realpath(validated)) !== target)
    throw new HttpError(409, 'File changed while opening its preview. Try again.')
  return target
}

/** Authorization is repeated after opening; no bytes escape before identity checks pass. */
export async function openValidatedPreview(resolveTarget: () => Promise<string>) {
  const target = await resolveTarget()
  const before = await lstat(target)
  if (!before.isFile()) throw new HttpError(400, 'Choose a regular file')
  // A regular file can become a FIFO after lstat; never block before fstat can reject it.
  const handle = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const opened = await handle.stat()
    const currentTarget = await resolveTarget()
    const current = await lstat(target)
    if (
      currentTarget !== target ||
      !opened.isFile() ||
      !current.isFile() ||
      before.dev !== opened.dev ||
      before.ino !== opened.ino ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw new HttpError(409, 'File changed while opening its preview. Try again.')
    return { target, handle }
  } catch (error) {
    await handle.close()
    throw error
  }
}

export async function openContainedPreview(root: string, path: string) {
  return openValidatedPreview(() => canonicalPreviewFile(root, path))
}
