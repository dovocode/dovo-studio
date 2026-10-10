import { constants, type Stats } from 'node:fs'
import {
  open,
  lstat,
  realpath,
  readdir,
  mkdir,
  mkdtemp,
  rm,
  type FileHandle,
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { HttpError } from '../errors.js'

const MAX_BYTES = 2 * 1024 * 1024 * 1024
const MAX_ENTRIES = 100000
const MAX_DEPTH = 256

function sameIdentity(before: Stats, after: Stats) {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode
}

function unchanged(before: Stats, after: Stats) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  )
}

function changed(): never {
  throw new HttpError(409, 'Artifact changed while staging; finish the build and try again')
}

function inside(root: string, path: string) {
  const location = relative(root, path)
  if (!location || location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location))
    throw new HttpError(403, 'Artifact must be inside the task checkout')
  return location
}

// Linux descriptor paths pin ancestors. Other platforms use verified paths and held file
// descriptors; every source identity is rechecked before a staged copy can be transferred.

export async function stageDeviceArtifact(
  artifactPath: string,
  allowedRoot: string,
): Promise<{
  file: string
  extension: '.apk' | '.app'
  directory: boolean
  dispose: () => Promise<void>
}> {
  const root = await realpath(allowedRoot)
  const source = resolve(root, artifactPath)
  const location = inside(root, source)
  const extension = extname(source)
  if (extension !== '.apk' && extension !== '.app')
    throw new HttpError(400, 'Choose an Android .apk or an Apple .app bundle')
  const staging = await mkdtemp(join(tmpdir(), 'dovo-device-artifact-'))
  const dispose = () => rm(staging, { recursive: true, force: true })
  const handles: FileHandle[] = []
  const sourceDirectories = new Map<number, string>()
  const directoryPath = (handle: FileHandle) =>
    process.platform === 'linux'
      ? `/proc/self/fd/${handle.fd}`
      : (sourceDirectories.get(handle.fd) ?? changed())
  const checks: Array<{ path: string; metadata: Stats; ancestor?: boolean }> = []
  let entries = 0
  let bytes = 0
  const verify = async (path: string, metadata: Stats, ancestor = false) => {
    const current = await lstat(path)
    if (!(ancestor ? sameIdentity : unchanged)(metadata, current)) changed()
    inside(root, await realpath(path))
  }
  const openDirectory = async (path: string, metadata: Stats, ancestor = false) => {
    const matches = ancestor ? sameIdentity : unchanged
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    )
    handles.push(handle)
    sourceDirectories.set(handle.fd, path)
    if (!matches(metadata, await handle.stat())) changed()
    // Verify the selected traversal path still names the directory we opened.
    if (!matches(metadata, await lstat(`${directoryPath(handle)}/.`))) changed()
    return handle
  }
  try {
    const rootMetadata = await lstat(root)
    const rootHandle = await openDirectory(root, rootMetadata, true)
    let parent = rootHandle
    const parts = location.split(sep)
    for (const part of parts.slice(0, -1)) {
      const path = join(directoryPath(parent), part)
      const metadata = await lstat(path)
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new HttpError(400, 'Artifact contains a symlink or unsupported file')
      await verify(path, metadata, true)
      checks.push({ path, metadata, ancestor: true })
      parent = await openDirectory(path, metadata, true)
    }
    const copy = async (path: string, destination: string, depth: number) => {
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory()))
        throw new HttpError(400, 'Artifact contains a symlink or unsupported file')
      if (++entries > MAX_ENTRIES || (bytes += metadata.size) > MAX_BYTES || depth > MAX_DEPTH)
        throw new HttpError(413, 'Artifact exceeds the install limit')
      await verify(path, metadata)
      checks.push({ path, metadata })
      if (metadata.isDirectory()) {
        const handle = await openDirectory(path, metadata)
        await mkdir(destination, { mode: 0o700 })
        for (const name of await readdir(directoryPath(handle)))
          await copy(join(directoryPath(handle), name), join(destination, name), depth + 1)
        await verify(path, metadata)
        return
      }
      const input = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      try {
        if (!unchanged(metadata, await input.stat())) changed()
        await verify(path, metadata)
        const output = await open(destination, 'wx', 0o600)
        try {
          const buffer = Buffer.alloc(1024 * 1024)
          let position = 0
          while (position < metadata.size) {
            const { bytesRead } = await input.read(
              buffer,
              0,
              Math.min(buffer.length, metadata.size - position),
              position,
            )
            if (!bytesRead) changed()
            let written = 0
            while (written < bytesRead) {
              const { bytesWritten } = await output.write(
                buffer,
                written,
                bytesRead - written,
                position + written,
              )
              if (!bytesWritten) throw new Error('Unable to write staged artifact')
              written += bytesWritten
            }
            position += bytesRead
          }
          await output.chmod(metadata.mode & 0o777)
        } finally {
          await output.close()
        }
        if (!unchanged(metadata, await input.stat())) changed()
        await verify(path, metadata)
      } finally {
        await input.close()
      }
    }
    const pinnedSource = join(directoryPath(parent), basename(source))
    const metadata = await lstat(pinnedSource)
    if (extension === '.apk' ? !metadata.isFile() : !metadata.isDirectory())
      throw new HttpError(400, 'Artifact type does not match its extension')
    const file = join(staging, `artifact${extension}`)
    await copy(pinnedSource, file, 0)
    for (const check of checks) await verify(check.path, check.metadata, check.ancestor)
    if (!sameIdentity(rootMetadata, await lstat(root))) changed()
    await verify(source, metadata)
    if ((await realpath(source)) !== source) changed()
    return { file, extension, directory: extension === '.app', dispose }
  } catch (error) {
    await dispose()
    throw error
  } finally {
    await Promise.all(handles.map((handle) => handle.close()))
  }
}
