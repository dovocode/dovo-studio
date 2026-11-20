import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { type FileHandle, lstat, open, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { errorMessage, HttpError } from '../../errors.js'
import { exec, processEnvironment } from '../../process.js'
import { prepareFileReplacement } from './publish-file.js'

// Studio editors share admission even when they reach the same file through different routes.
// External editors retain their own ownership; callers compare again inside the action.
const pendingWrites = new Map<string, Promise<void>>()

export async function withFileWrite<A>(filename: string, action: () => Promise<A>): Promise<A> {
  const key = await realpath(filename).catch(async (error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    return join(await realpath(dirname(filename)), basename(filename))
  })
  const previous = pendingWrites.get(key)
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  pendingWrites.set(key, pending)
  try {
    await previous
    return await action()
  } finally {
    release()
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key)
  }
}

const code = (error: unknown) =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
const denied = (error: unknown) => ['EACCES', 'EPERM', 'EROFS'].includes(code(error) ?? '')
const unchanged = 'The file was not changed. Your draft is still in the editor.'
const readOnly = () => new HttpError(403, `This file is read-only. ${unchanged}`)
const changedOnDisk = () => new HttpError(409, 'File changed on disk. Reload it before saving.')
// A chmod, chown or new link changes ctime, so this also catches metadata changes.
const sameFile = (a: Stats, b: Stats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs &&
  a.mode === b.mode &&
  a.uid === b.uid &&
  a.gid === b.gid &&
  a.nlink === b.nlink

/**
 * Replace a working-tree file without truncating it first.
 *
 * The new contents are written, size-checked and synced in a sibling temporary file, which is then
 * renamed over the original. A full disk or file-size limit leaves the original intact. A final
 * symlink keeps pointing at its target.
 *
 * Studio never writes the original in place. A save that cannot finish with a rename is refused
 * before the file changes: the file is read-only, its folder does not allow a temporary file, it
 * has other hard links, its owner cannot be kept, its extended attributes or access control list
 * would change, or the system refuses the rename.
 *
 * Linux copies ACLs and extended attributes before the final sync. Failure to copy the metadata
 * leaves the original in place.
 */
export async function replaceFileContents(target: string, contents: string) {
  const path = await realpath(target).catch((error: unknown) => {
    if (code(error) === 'ENOENT') return target
    throw error
  })
  const original: Stats | undefined = await stat(path).catch((error: unknown) => {
    if (code(error) === 'ENOENT') return undefined
    throw error
  })
  if (original && !original.isFile())
    throw new HttpError(409, `Only regular files can be saved. ${unchanged}`)
  // A rename gives this path a new file. The other names would keep the old text.
  if (original && original.nlink > 1)
    throw new HttpError(
      409,
      `This file has other hard links. Studio cannot save it without separating them. Edit it in an editor that writes in place, or replace the links with copies. ${unchanged}`,
    )
  // A rename needs write access to the folder, not the file. Keep the file's own permission. Opening
  // the file for writing also applies access control lists and immutable or append-only flags.
  if (original) {
    const writable = await open(path, 'r+').catch((error: unknown) => {
      throw denied(error) ? readOnly() : error
    })
    await writable.close()
  }
  const data = Buffer.from(contents, 'utf8')
  const temporary = join(dirname(path), `.${basename(path)}.dovo-${randomUUID()}.tmp`)
  let handle: FileHandle
  try {
    // A new file gets the umask. A replacement stays private until it has the original's mode.
    handle = await open(temporary, 'wx', original ? 0o600 : 0o666)
  } catch (error) {
    // Without a temporary file, the only option is to truncate the original first. A full disk or
    // size limit would then destroy it.
    if (denied(error))
      throw new HttpError(
        403,
        `Studio cannot save this file safely because its folder does not allow new files. ${unchanged}`,
      )
    throw error
  }
  try {
    try {
      try {
        await handle.writeFile(data)
      } catch (error) {
        if (['EFBIG', 'ENOSPC', 'EDQUOT'].includes(code(error) ?? ''))
          throw new HttpError(507, `Could not save: ${errorMessage(error)}. ${unchanged}`)
        throw error
      }
      if ((await handle.stat()).size !== data.length)
        throw new HttpError(507, `The saved copy was incomplete. ${unchanged}`)
      if (original) {
        // A setgid folder can give the temporary file a different group from the original.
        const staged = await handle.stat()
        if (original.uid !== staged.uid || original.gid !== staged.gid)
          await handle.chown(original.uid, original.gid).catch((error: unknown) => {
            if (!denied(error)) throw error
            throw new HttpError(
              409,
              `Studio cannot keep this file's owner or group. Save it as the account that owns it. ${unchanged}`,
            )
          })
        // After chown, which clears setuid and setgid bits.
        if (process.platform === 'linux') await copyLinuxMetadata(path, temporary)
        else await handle.chmod(original.mode & 0o7777)
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    await prepareFileReplacement(temporary, path, !!original)
    // An external editor may have replaced or changed the file while the copy was written.
    const current = await lstat(path).catch((error: unknown) => {
      if (code(error) === 'ENOENT') return undefined
      throw error
    })
    if (original ? !current || !sameFile(original, current) : current) throw changedOnDisk()
    try {
      await rename(temporary, path)
    } catch (error) {
      // Windows refuses to replace a file that another process holds open. A sticky folder
      // refuses to replace a file that another account owns.
      if (!denied(error) && code(error) !== 'EBUSY') throw error
      throw new HttpError(
        409,
        `The system did not allow Studio to replace this file. Close other programs that use it, then save again. ${unchanged}`,
      )
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

/** GNU cp copies ACLs with mode and extended attributes with xattr. An explicit list asks cp
 * to report preservation failures. --attributes-only leaves the already staged contents intact. */
async function copyLinuxMetadata(source: string, destination: string) {
  try {
    const { stderr } = await exec(
      '/bin/cp',
      ['--attributes-only', '--preserve=mode,xattr', '--', source, destination],
      { timeout: 10_000, env: processEnvironment() },
    )
    if (!stderr) return
  } catch (error) {
    throw new HttpError(
      409,
      `Could not copy file metadata with GNU cp: ${errorMessage(error)}. ${unchanged}`,
    )
  }
  throw new HttpError(409, `GNU cp reported a warning while copying file metadata. ${unchanged}`)
}
