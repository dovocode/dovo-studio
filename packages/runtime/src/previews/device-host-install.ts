import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath, stat, lstat, readdir, readFile, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, extname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { HttpError } from '../errors.js'
import { androidTool, previewDevices } from './devices.js'
const exec = promisify(execFile)
/** Reject symlinks inside .app bundles as well as paths escaping the permitted task checkout. */
export async function validateArtifact(path: string, allowedRoot: string) {
  const root = await realpath(allowedRoot)
  const file = await realpath(resolve(root, path))
  const location = relative(root, file)
  if (
    !location ||
    location.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    location === '..' ||
    isAbsolute(location)
  )
    throw new HttpError(403, 'Artifact must be inside the task checkout')
  const extension = extname(file)
  if (!['.apk', '.app'].includes(extension))
    throw new HttpError(400, 'Choose an Android .apk or an Apple .app bundle')
  const metadata = await stat(file)
  if (extension === '.apk' ? !metadata.isFile() : !metadata.isDirectory())
    throw new HttpError(400, 'Artifact type does not match its extension')
  let bytes = 0,
    files = 0
  const inspect = async (current: string) => {
    const info = await lstat(current)
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw new HttpError(400, 'Artifact contains a symlink or unsupported file')
    if (++files > 100000 || (bytes += info.size) > 2 * 1024 * 1024 * 1024)
      throw new HttpError(413, 'Artifact exceeds the install limit')
    if (info.isDirectory())
      for (const name of await readdir(current)) await inspect(join(current, name))
  }
  await inspect(file)
  return { file, extension, directory: extension === '.app' }
}
export async function installNative(
  id: string,
  file: string,
  authorize: () => void = () => {},
  signal?: AbortSignal,
) {
  const device = (await previewDevices()).devices.find((device) => device.id === id)
  if (!device) throw new HttpError(404, 'Device is no longer available')
  if (device.state !== 'booted')
    throw new HttpError(409, 'Start or connect this device before installing')
  authorize()
  const extension = extname(file)
  if (device.platform === 'android') {
    if (extension !== '.apk') throw new HttpError(400, 'Android devices require an .apk artifact')
    const adb = await androidTool('adb')
    authorize()
    await exec(adb, ['-s', device.runtime, 'install', '-r', file], {
      signal,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    })
  } else {
    if (process.platform !== 'darwin' || extension !== '.app')
      throw new HttpError(400, 'iOS requires a macOS host and an .app bundle')
    const { stdout } = await exec(
      'plutil',
      ['-convert', 'json', '-o', '-', join(file, 'Info.plist')],
      { timeout: 10000, maxBuffer: 1024 * 1024, signal },
    )
    const info: unknown = JSON.parse(stdout)
    const supported =
      info && typeof info === 'object' && 'CFBundleSupportedPlatforms' in info
        ? info.CFBundleSupportedPlatforms
        : undefined
    const platform = device.kind === 'physical' ? 'iPhoneOS' : 'iPhoneSimulator'
    if (!Array.isArray(supported) || !supported.includes(platform))
      throw new HttpError(400, `This target requires an app built for ${platform}`)
    if (device.kind === 'physical') {
      try {
        await readFile(join(file, 'embedded.mobileprovision'))
        await exec('codesign', ['--verify', '--deep', '--strict', file], {
          signal,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        })
      } catch {
        throw new HttpError(
          400,
          'Physical iPhones require a signed .app with an embedded provisioning profile',
        )
      }
      authorize()
      await exec(
        'xcrun',
        ['devicectl', 'device', 'install', 'app', '--device', device.runtime, file],
        { timeout: 120000, maxBuffer: 1024 * 1024, signal },
      )
    } else {
      authorize()
      await exec('xcrun', ['simctl', 'install', id.slice('ios:'.length), file], {
        signal,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      })
    }
  }
  return { ok: true as const }
}
type Upload = {
  owner: string
  directory: string
  path: string
  timer: ReturnType<typeof setTimeout>
  installing: boolean
}
export class DeviceHostUploads {
  private uploads = new Map<string, Upload>()
  private pending = new Set<Promise<unknown>>()
  private disposed = false
  private creating = 0
  private epoch = 0
  private installs = new Map<string, { owner: string; controller: AbortController }>()
  cancelAll() {
    this.epoch++
    for (const operation of this.installs.values()) operation.controller.abort()
    for (const [id, upload] of this.uploads)
      if (!upload.installing) this.cleanupStaging(id, upload.owner)
  }
  private cleanupStaging(id: string, owner: string) {
    const operation = this.remove(id, owner).catch((error) =>
      console.warn('Device artifact cleanup failed', error),
    )
    this.pending.add(operation)
    void operation.finally(() => this.pending.delete(operation))
  }
  cancelDevice(deviceId: string) {
    const prefix = `device-host:${JSON.stringify([deviceId]).slice(0, -1)},`
    for (const operation of this.installs.values())
      if (operation.owner.startsWith(prefix)) operation.controller.abort()
    for (const [id, upload] of this.uploads)
      if (upload.owner.startsWith(prefix) && !upload.installing)
        this.cleanupStaging(id, upload.owner)
  }
  async create(owner: string, extension: '.apk' | '.app') {
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    if (this.uploads.size + this.creating >= 20)
      throw new HttpError(409, 'Too many staged device artifacts')
    const epoch = this.epoch
    this.creating++
    let directory: string
    try {
      directory = await mkdtemp(join(tmpdir(), 'dovo-device-host-'))
    } finally {
      this.creating--
    }
    if (this.disposed || epoch !== this.epoch) {
      await rm(directory, { recursive: true, force: true })
      throw new HttpError(
        this.disposed ? 503 : 409,
        this.disposed
          ? 'Runtime is shutting down'
          : 'Artifact staging was cancelled by device cleanup',
      )
    }
    const id = randomUUID(),
      path = join(directory, `artifact${extension}`)
    const timer = setTimeout(() => {
      void this.remove(id, owner).catch((error) =>
        console.warn('Device artifact cleanup failed', error),
      )
    }, 300000)
    timer.unref()
    this.uploads.set(id, { owner, directory, path, timer, installing: false })
    return { id, path }
  }
  private get(id: string, owner: string) {
    const upload = this.uploads.get(id)
    if (!upload) throw new HttpError(404, 'Artifact staging expired')
    if (upload.owner !== owner)
      throw new HttpError(403, 'Artifact staging belongs to another paired device or task')
    return upload
  }
  async install(
    id: string,
    owner: string,
    deviceId: string,
    authorize: () => void = () => {},
    signal?: AbortSignal,
  ) {
    const upload = this.get(id, owner)
    if (upload.installing) throw new HttpError(409, 'Artifact install is already in progress')
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    upload.installing = true
    const controller = new AbortController()
    this.installs.set(id, { owner, controller })
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const assertAuthorized = () => {
      combined.throwIfAborted()
      authorize()
    }
    clearTimeout(upload.timer)
    const operation = (async () => {
      try {
        const artifact = await validateArtifact(upload.path, upload.directory)
        if (basename(artifact.file) !== basename(upload.path))
          throw new HttpError(403, 'Invalid staged artifact')
        assertAuthorized()
        const result = await installNative(deviceId, artifact.file, assertAuthorized, combined)
        assertAuthorized()
        return result
      } catch (error) {
        if (combined.aborted)
          throw new HttpError(409, 'App installation was cancelled by device cleanup')
        throw error
      } finally {
        this.installs.delete(id)
        upload.installing = false
        await this.remove(id, owner)
      }
    })()
    this.pending.add(operation)
    try {
      return await operation
    } finally {
      this.pending.delete(operation)
    }
  }
  async remove(id: string, owner: string) {
    const upload = this.uploads.get(id)
    if (!upload) return
    this.get(id, owner)
    if (upload.installing) throw new HttpError(409, 'Artifact install is in progress')
    this.uploads.delete(id)
    clearTimeout(upload.timer)
    await rm(upload.directory, { recursive: true, force: true })
  }
  async dispose() {
    this.disposed = true
    this.cancelAll()
    await Promise.allSettled([...this.pending])
    await Promise.all([...this.uploads].map(([id, upload]) => this.remove(id, upload.owner)))
  }
}
