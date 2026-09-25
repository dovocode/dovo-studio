import { randomUUID, createHash } from 'node:crypto'
import { createWriteStream, realpathSync } from 'node:fs'
import {
  chmod,
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep, delimiter } from 'node:path'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { Transform } from 'node:stream'
import { mutableArray, mutableStruct, decode } from '@dovo/protocol'
import {
  acpInstallationSchema,
  acpRegistryResponseSchema,
  type AcpInstallation,
  type AcpRegistryAgent,
  type AcpRegistryResponse,
} from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import * as tar from 'tar'
import * as unzipper from 'unzipper'
import { processEnvironment } from '../process.js'
import { stopAcpChild } from './providers/acp-process.js'
import {
  REGISTRY_URL,
  distributionAvailable,
  parseRegistryResponse,
  platformKey,
  publicUrl,
  selectedDistribution,
  type BinaryTarget,
  type Distribution,
  type PackageDistribution,
} from './acp-installation/registry.js'

const MAX_REGISTRY_BYTES = 8 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 100_000
const INSTALL_DOCUMENT_ID = 'acp-installations'

const boundedString = (max: number) => Schema.String.pipe(Schema.maxLength(max))
const argsSchema = mutableArray(boundedString(4096))
const environmentSchema = Schema.Record({
  key: boundedString(256),
  value: boundedString(4096),
})
const packageBinSchema = Schema.Union(Schema.String, environmentSchema)
const storedInstallationSchema = mutableStruct({
  ...acpInstallationSchema.fields,
  command: boundedString(4096),
  args: argsSchema,
  env: environmentSchema,
  installPath: boundedString(8192),
  metadataPath: boundedString(8192),
})
const storedInstallationsSchema = mutableArray(storedInstallationSchema)
type StoredInstallation = Schema.Schema.Type<typeof storedInstallationSchema>
export type AcpLaunch = { command: string; args: string[]; env: Record<string, string> }

type RunCommand = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>

export type AcpInstallationsOptions = {
  fetch?: typeof fetch
  platform?: NodeJS.Platform
  arch?: string
  runCommand?: RunCommand
}

function safeArchivePath(root: string, entryPath: string) {
  const normalized = entryPath.replaceAll('\\', '/')
  if (normalized === '.' || normalized === './') return root
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized))
    throw new Error('Agent archive contains an absolute path')
  const target = resolve(root, normalized)
  const rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('Agent archive contains an unsafe path')
  return target
}

function pathIsInside(root: string, candidate: string) {
  const rel = relative(resolve(root), resolve(candidate))
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function realPathIsInside(root: string, candidate: string) {
  try {
    return pathIsInside(realpathSync(root), realpathSync(candidate))
  } catch {
    return false
  }
}

function packageName(spec: string, kind: 'npx' | 'uvx') {
  if (kind === 'npx') {
    const match = spec.match(
      /^(@[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/,
    )
    if (!match) throw new Error('ACP Registry npm package must have a pinned version')
    return { name: match[1]!, spec }
  }
  const match = spec.match(
    /^([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:@|==)([0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/,
  )
  if (!match) throw new Error('ACP Registry Python package must have a pinned version')
  return { name: match[1]!, spec: `${match[1]}==${match[2]}` }
}

function packageBinPath(
  packageRoot: string,
  bin: Schema.Schema.Type<typeof packageBinSchema> | undefined,
  shortName: string,
) {
  const value =
    typeof bin === 'string'
      ? bin
      : bin
        ? (bin[shortName] ??
          (new Set(Object.values(bin)).size === 1 ? Object.values(bin)[0] : undefined))
        : undefined
  if (typeof value !== 'string' || !value)
    throw new Error('Installed ACP package does not declare an executable')
  const target = resolve(packageRoot, value)
  const rel = relative(packageRoot, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error('ACP package executable points outside its install directory')
  return target
}

async function copyResponse(response: Response, destination: string, maxBytes: number) {
  if (!response.body) throw new Error('Empty ACP Registry download')
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body.cancel()
    throw new Error('ACP Registry download is too large')
  }
  let size = 0
  const hash = createHash('sha256')
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > maxBytes) return callback(new Error('ACP Registry download is too large'))
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const body = response.body
  const chunks = async function* () {
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  await pipeline(
    Readable.from(chunks()),
    limit,
    createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
  )
  return hash.digest('hex')
}

async function extractZip(file: string, root: string, signal: AbortSignal) {
  const directory = await unzipper.Open.file(file)
  let total = 0
  if (directory.files.length > MAX_ARCHIVE_ENTRIES)
    throw new Error('Agent archive contains too many entries')
  for (const entry of directory.files) {
    signal.throwIfAborted()
    const destination = safeArchivePath(root, entry.path)
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
    if ((unixMode & 0o170000) === 0o120000)
      throw new Error('Agent archive contains a symbolic link')
    if (entry.type === 'Directory') {
      await mkdir(destination, { recursive: true, mode: 0o700 })
      continue
    }
    if (entry.type !== 'File') throw new Error('Agent archive contains a link or unsupported entry')
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    const count = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length
        if (total > MAX_EXTRACTED_BYTES)
          return callback(new Error('Expanded agent archive is too large'))
        callback(null, chunk)
      },
    })
    await pipeline(
      entry.stream(),
      count,
      // Preserve only owner execution for helpers; never inherit public or special bits.
      createWriteStream(destination, { flags: 'wx', mode: unixMode & 0o111 ? 0o700 : 0o600 }),
      { signal },
    )
  }
}

async function extractTar(file: string, root: string, signal: AbortSignal) {
  let total = 0
  let entries = 0
  let invalidEntry: Error | undefined
  await tar.x({
    file,
    cwd: root,
    strict: true,
    preservePaths: false,
    filter: (path, entry) => {
      entries++
      if (invalidEntry) return false
      if (signal.aborted) {
        invalidEntry = new Error('ACP installation was cancelled')
        return false
      }
      if (entries > MAX_ARCHIVE_ENTRIES) {
        invalidEntry = new Error('Agent archive contains too many entries')
        return false
      }
      const type =
        'type' in entry
          ? entry.type
          : entry.isDirectory()
            ? 'Directory'
            : entry.isSymbolicLink()
              ? 'SymbolicLink'
              : 'File'
      if ((path === '.' || path === './') && type === 'Directory') return true
      try {
        safeArchivePath(root, path)
      } catch {
        invalidEntry = new Error('Agent archive contains an unsafe path')
        return false
      }
      if (type !== 'Directory' && type !== 'File') {
        invalidEntry = new Error('Agent archive contains a link or unsupported entry')
        return false
      }
      if (type === 'File') {
        total += entry.size
        if (total > MAX_EXTRACTED_BYTES) {
          invalidEntry = new Error('Expanded agent archive is too large')
          return false
        }
      }
      return true
    },
  })
  if (invalidEntry) throw invalidEntry
}

async function decompressBzip2(file: string, output: string, active: Set<ChildProcess>) {
  const child = spawn('bzip2', ['-dc', file], {
    env: processEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  active.add(child)
  let stderr = ''
  let size = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > MAX_EXTRACTED_BYTES)
        return callback(new Error('Expanded agent archive is too large'))
      callback(null, chunk)
    },
  })
  let stopping: Promise<void> | undefined
  const stop = () => (stopping ??= stopAcpChild(child))
  const timer = setTimeout(() => void stop(), 5 * 60_000)
  child.stderr.on(
    'data',
    (chunk: Buffer) => (stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000)),
  )
  const writing = pipeline(
    child.stdout,
    limit,
    createWriteStream(output, { flags: 'wx', mode: 0o600 }),
  )
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolvePromise, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolvePromise({ code, signal }))
    },
  )
  try {
    const [result] = await Promise.all([closed, writing])
    if (result.code !== 0)
      throw new Error(
        `Could not decompress this agent archive. Install bzip2 on the runtime host. ${stderr || result.signal || result.code}`,
      )
  } catch (error) {
    await stop()
    throw new Error(
      `Could not decompress this agent archive. Install bzip2 on the runtime host. ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    clearTimeout(timer)
    if (stopping) await stopping
    active.delete(child)
  }
}

async function extractArchive(
  file: string,
  archiveUrl: string,
  root: string,
  command: string,
  active: Set<ChildProcess>,
  signal: AbortSignal,
) {
  const pathname = new URL(archiveUrl).pathname.toLowerCase()
  if (pathname.endsWith('.zip')) return extractZip(file, root, signal)
  if (pathname.endsWith('.tar.gz') || pathname.endsWith('.tgz'))
    return extractTar(file, root, signal)
  if (pathname.endsWith('.tar.bz2') || pathname.endsWith('.tbz2')) {
    const tarFile = join(root, '.agent.tar')
    await decompressBzip2(file, tarFile, active)
    await extractTar(tarFile, root, signal)
    await rm(tarFile, { force: true })
    return
  }
  const executable = safeArchivePath(root, command.replace(/^[./\\]+/, ''))
  await mkdir(dirname(executable), { recursive: true, mode: 0o700 })
  await rename(file, executable)
}

function isSafeEnvironment(value: Record<string, string> | undefined) {
  const env: Record<string, string> = {}
  for (const [key, item] of Object.entries(value ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key === 'DOVO_OWNER_TOKEN') continue
    env[key] = item
  }
  return env
}

export class AcpInstallations {
  private readonly fetcher: typeof fetch
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly runCommand: RunCommand
  private installations = new Map<string, StoredInstallation>()
  private pending = new Map<string, Promise<unknown>>()
  private readonly activeChildren = new Set<ChildProcess>()
  private readonly activeStops = new Set<Promise<void>>()
  private readonly lifecycle = new AbortController()
  private disposePromise?: Promise<void>
  private disposed = false

  private stopProcess(child: ChildProcess) {
    const stopped = stopAcpChild(child)
    this.activeStops.add(stopped)
    void stopped.finally(() => this.activeStops.delete(stopped))
    return stopped
  }

  constructor(
    private readonly db: Database.Database,
    private readonly directory = join(homedir(), '.dovo', 'acp-agents'),
    options: AcpInstallationsOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.runCommand =
      options.runCommand ??
      ((command, args, commandOptions) => this.executeTracked(command, args, commandOptions))
    const row = decode(
      Schema.UndefinedOr(mutableStruct({ value: Schema.String })),
      db.prepare('SELECT value FROM documents WHERE id = ?').get(INSTALL_DOCUMENT_ID),
    )
    if (row) {
      const saved = decode(storedInstallationsSchema, JSON.parse(row.value))
      this.installations = new Map(saved.map((installation) => [installation.id, installation]))
    }
  }

  private executeTracked(
    command: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
  ): Promise<{ stdout: string; stderr: string }> {
    if (this.disposed) return Promise.reject(new Error('ACP installation service is shutting down'))
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? processEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: this.platform !== 'win32',
      })
      this.activeChildren.add(child)
      let stdout = ''
      let stderr = ''
      const append = (current: string, chunk: Buffer) =>
        `${current}${chunk.toString('utf8')}`.slice(-12_000)
      child.stdout.on('data', (chunk: Buffer) => (stdout = append(stdout, chunk)))
      child.stderr.on('data', (chunk: Buffer) => (stderr = append(stderr, chunk)))
      let timedOut = false
      const timeout = setTimeout(
        () => {
          timedOut = true
          void this.stopProcess(child)
        },
        Math.min(options.timeout ?? 9 * 60_000, 9 * 60_000),
      )
      const kill = () => void this.stopProcess(child)
      this.lifecycle.signal.addEventListener('abort', kill, { once: true })
      const cleanup = () => {
        clearTimeout(timeout)
        this.lifecycle.signal.removeEventListener('abort', kill)
        this.activeChildren.delete(child)
      }
      child.once('error', (error) => {
        cleanup()
        reject(new Error(`Could not run ${command}: ${error.message}`))
      })
      child.once('close', (code, signal) => {
        cleanup()
        if (code === 0 && !timedOut && !this.lifecycle.signal.aborted)
          resolvePromise({ stdout, stderr })
        else
          reject(new Error(`${basename(command)} failed (${code ?? signal}). ${stderr || stdout}`))
      })
    })
  }

  list(): AcpInstallation[] {
    return [...this.installations.values()].map((installation) =>
      this.publicInstallation(installation),
    )
  }

  isBusy(id: string) {
    return this.pending.has(id)
  }

  dispose(): Promise<void> {
    if (!this.disposePromise) {
      this.disposed = true
      this.lifecycle.abort(new Error('Runtime is shutting down'))
      for (const child of this.activeChildren) void this.stopProcess(child)
      this.disposePromise = Promise.allSettled([
        ...this.pending.values(),
        ...this.activeStops,
      ]).then(() => undefined)
    }
    return this.disposePromise
  }

  async registry(): Promise<AcpRegistryResponse> {
    const result = await this.readRegistry()
    const target = platformKey(this.platform, this.arch)
    const ids = new Set<string>()
    const agents: AcpRegistryAgent[] = []
    for (const entry of result.agents) {
      if (ids.has(entry.id)) continue
      ids.add(entry.id)
      const selected = selectedDistribution(entry, target)
      if (!selected) continue
      const installation = this.installations.get(entry.id)
      agents.push({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        ...(publicUrl(entry.repository) ? { repository: publicUrl(entry.repository) } : {}),
        ...(publicUrl(entry.website) ? { website: publicUrl(entry.website) } : {}),
        ...(entry.authors ? { authors: entry.authors } : {}),
        ...(entry.license ? { license: entry.license } : {}),
        ...(publicUrl(entry.license_url) ? { licenseUrl: publicUrl(entry.license_url) } : {}),
        ...(publicUrl(entry.icon) ? { icon: publicUrl(entry.icon) } : {}),
        distribution: selected.kind,
        available: distributionAvailable(entry, target),
        ...(installation ? { installed: this.publicInstallation(installation) } : {}),
      })
    }
    return decode(acpRegistryResponseSchema, {
      version: result.version,
      agents,
      installations: this.list(),
    })
  }

  async install(registryId: string): Promise<AcpInstallation> {
    return this.withLock(registryId, async () => {
      const registry = await this.readRegistry()
      const entry = registry.agents.find((agent) => agent.id === registryId)
      if (!entry) throw new Error('This agent is no longer listed in the ACP Registry')
      const distribution = selectedDistribution(entry, platformKey(this.platform, this.arch))
      if (!distribution || !distributionAvailable(entry, platformKey(this.platform, this.arch)))
        throw new Error('This ACP agent does not have a distribution for the runtime host')
      const current = this.installations.get(registryId)
      if (current?.version === entry.version && (await this.isManagedInstallation(current)))
        return this.publicInstallation(current)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const parent = join(this.directory, registryId)
      await mkdir(parent, { recursive: true, mode: 0o700 })
      const target = join(parent, `${entry.version}-${randomUUID()}`)
      try {
        await mkdir(target, { recursive: false, mode: 0o700 })
        const launch = await this.prepareDistribution(distribution, target)
        this.lifecycle.signal.throwIfAborted()
        const metadata = join(target, 'registry-entry.json')
        await writeFile(metadata, JSON.stringify(entry), { mode: 0o600 })
        const record = decode(storedInstallationSchema, {
          id: registryId,
          registryId,
          name: entry.name,
          version: entry.version,
          distribution: distribution.kind,
          installedAt: new Date().toISOString(),
          command: launch.command,
          args: launch.args,
          env: launch.env,
          installPath: target,
          metadataPath: join(target, 'registry-entry.json'),
        })
        this.installations.set(record.id, record)
        try {
          this.persist()
        } catch (error) {
          if (current) this.installations.set(record.id, current)
          else this.installations.delete(record.id)
          throw error
        }
        return this.publicInstallation(record)
      } catch (error) {
        await rm(target, { recursive: true, force: true }).catch(() => {})
        throw error
      }
    })
  }

  async remove(id: string): Promise<void> {
    await this.withLock(id, async () => {
      const current = this.installations.get(id)
      if (!current) return
      if (!this.isManagedInstallationPath(current))
        throw new Error('ACP installation path is outside the managed directory')
      const managedParent = resolve(this.directory, id)
      const trash = join(dirname(managedParent), `.remove-${randomUUID()}`)
      await rename(managedParent, trash)
      this.installations.delete(id)
      try {
        this.persist()
      } catch (error) {
        this.installations.set(id, current)
        await rename(trash, managedParent).catch(() => {})
        throw error
      }
      await rm(trash, { recursive: true, force: true })
    })
  }

  launch(id: string): AcpLaunch {
    if (this.pending.has(id)) throw new Error('ACP agent installation is being changed')
    const installation = this.installations.get(id)
    if (!installation) throw new Error('ACP agent is not installed on this runtime')
    if (!this.isManagedInstallationPath(installation))
      throw new Error('ACP installation path is outside the managed directory')
    return {
      command: installation.command,
      args: [...installation.args],
      env: { ...installation.env },
    }
  }

  private isManagedInstallationPath(value: StoredInstallation) {
    const expectedParent = resolve(this.directory, value.id)
    const installPath = resolve(value.installPath)
    const commandIsManaged =
      pathIsInside(installPath, value.command) && realPathIsInside(installPath, value.command)
    const windowsNodeBinIsManaged =
      value.distribution === 'npx' &&
      /^node(?:\.exe)?$/i.test(value.command) &&
      !!value.args[0] &&
      pathIsInside(installPath, value.args[0]) &&
      realPathIsInside(installPath, value.args[0])
    return dirname(installPath) === expectedParent && (commandIsManaged || windowsNodeBinIsManaged)
  }

  private async isManagedInstallation(value: StoredInstallation) {
    if (!this.isManagedInstallationPath(value)) return false
    const commandFile = pathIsInside(value.installPath, value.command)
      ? value.command
      : value.args[0]
    if (!commandFile) return false
    const [directory, command] = await Promise.all([
      stat(value.installPath).catch(() => undefined),
      stat(commandFile).catch(() => undefined),
    ])
    return directory?.isDirectory() === true && command?.isFile() === true
  }

  private publicInstallation(value: StoredInstallation): AcpInstallation {
    return decode(acpInstallationSchema, {
      id: value.id,
      registryId: value.registryId,
      name: value.name,
      version: value.version,
      distribution: value.distribution,
      installedAt: value.installedAt,
    })
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('ACP installation service is shutting down')
    if (this.pending.has(id)) throw new Error('ACP agent installation is already being changed')
    const work = Promise.resolve().then(operation)
    const pending = work.then(
      () => undefined,
      () => undefined,
    )
    this.pending.set(id, pending)
    try {
      return await work
    } finally {
      if (this.pending.get(id) === pending) this.pending.delete(id)
    }
  }

  private persist() {
    const value = JSON.stringify([...this.installations.values()])
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(INSTALL_DOCUMENT_ID, value)
  }

  private async readRegistry() {
    const response = await this.fetcher(REGISTRY_URL, {
      signal: AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(20_000)]),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`ACP Registry request failed (${response.status})`)
    if (response.url && new URL(response.url).protocol !== 'https:') {
      await response.body?.cancel()
      throw new Error('ACP Registry redirected to a non-HTTPS address')
    }
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length > MAX_REGISTRY_BYTES) {
      await response.body?.cancel()
      throw new Error('ACP Registry response is too large')
    }
    if (!response.body) throw new Error('ACP Registry returned an empty response')
    const chunks: Uint8Array[] = []
    let byteLength = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        byteLength += value.byteLength
        if (byteLength > MAX_REGISTRY_BYTES) throw new Error('ACP Registry response is too large')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    let raw: unknown
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new Error('ACP Registry returned invalid JSON')
    }
    return parseRegistryResponse(raw)
  }

  private async prepareDistribution(
    distribution: Distribution,
    staging: string,
  ): Promise<AcpLaunch> {
    if (distribution.kind === 'binary') return this.installBinary(distribution.value, staging)
    if (distribution.kind === 'npx') return this.installNpmPackage(distribution.value, staging)
    return this.installPythonPackage(distribution.value, staging)
  }

  private async installBinary(target: BinaryTarget, staging: string): Promise<AcpLaunch> {
    const archiveUrl = new URL(target.archive)
    if (archiveUrl.protocol !== 'https:' || archiveUrl.username || archiveUrl.password)
      throw new Error('ACP Registry binary archives must use HTTPS')
    const response = await this.fetcher(archiveUrl, {
      signal: AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(5 * 60_000)]),
    })
    if (!response.ok) throw new Error(`ACP agent download failed (${response.status})`)
    if (response.url && new URL(response.url).protocol !== 'https:') {
      await response.body?.cancel()
      throw new Error('ACP agent download redirected to a non-HTTPS address')
    }
    const download = join(staging, '.download')
    const digest = await copyResponse(response, download, MAX_DOWNLOAD_BYTES)
    if (target.sha256 && digest.toLowerCase() !== target.sha256.toLowerCase())
      throw new Error('ACP agent archive checksum did not match the Registry')
    this.lifecycle.signal.throwIfAborted()
    await extractArchive(
      download,
      archiveUrl.href,
      staging,
      target.cmd,
      this.activeChildren,
      this.lifecycle.signal,
    )
    await rm(download, { force: true })
    const executable = safeArchivePath(staging, target.cmd.replace(/^\.\//, ''))
    const info = await lstat(executable).catch(() => undefined)
    if (!info?.isFile()) throw new Error('ACP Registry executable was not found in its archive')
    if (this.platform !== 'win32') await chmod(executable, 0o700)
    return {
      command: executable,
      args: target.args ?? [],
      env: isSafeEnvironment(target.env),
    }
  }

  private async installNpmPackage(value: PackageDistribution, staging: string): Promise<AcpLaunch> {
    const parsed = packageName(value.package, 'npx')
    const install = join(staging, 'npm')
    await mkdir(install, { recursive: true, mode: 0o700 })
    const npmCli = this.platform === 'win32' ? await this.findNpmCli() : undefined
    const npm = this.platform === 'win32' ? 'node' : 'npm'
    await this.runCommand(
      npm,
      [
        ...(npmCli ? [npmCli] : []),
        'install',
        '--prefix',
        install,
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--no-save',
        parsed.spec,
      ],
      {
        env: { ...processEnvironment(), npm_config_update_notifier: 'false' },
        timeout: 8 * 60_000,
      },
    )
    const packageRoot = join(install, 'node_modules', ...parsed.name.split('/'))
    const pkg = decode(
      mutableStruct({ bin: Schema.optional(packageBinSchema) }),
      JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')),
    )
    const executable = packageBinPath(packageRoot, pkg.bin, basename(parsed.name))
    const file = await stat(executable).catch(() => undefined)
    if (!file?.isFile()) throw new Error('Installed npm ACP executable was not found')
    const agentEnv = isSafeEnvironment(value.env)
    const configuredPath =
      this.platform === 'win32' ? (agentEnv.PATH ?? agentEnv.Path) : agentEnv.PATH
    return {
      command: this.platform === 'win32' ? 'node' : executable,
      args:
        this.platform === 'win32' ? [executable, ...(value.args ?? [])] : [...(value.args ?? [])],
      env: {
        ...agentEnv,
        PATH: `${join(install, 'node_modules', '.bin')}${delimiter}${configuredPath ?? processEnvironment().PATH ?? ''}`,
      },
    }
  }

  private async findNpmCli() {
    const env = processEnvironment()
    const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1]
    for (const directory of (pathValue ?? '').split(delimiter)) {
      if (!directory) continue
      const candidate = join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      try {
        await access(candidate)
        return candidate
      } catch {
        // Continue through PATH; npm may be installed beside another node shim.
      }
    }
    throw new Error('Could not locate npm-cli.js on the runtime host')
  }

  private async installPythonPackage(
    value: PackageDistribution,
    staging: string,
  ): Promise<AcpLaunch> {
    const parsed = packageName(value.package, 'uvx')
    const bin = join(staging, 'bin')
    const uvToolDir = join(staging, 'tools')
    await mkdir(bin, { recursive: true, mode: 0o700 })
    await this.runCommand('uv', ['tool', 'install', '--quiet', parsed.spec], {
      env: { ...processEnvironment(), UV_TOOL_BIN_DIR: bin, UV_TOOL_DIR: uvToolDir },
      timeout: 8 * 60_000,
    })
    const files = (await readdir(bin)).filter((name) => !name.startsWith('.'))
    if (!files.length) throw new Error('uv installed no ACP executable')
    const matchingBin = files.find(
      (name) =>
        name.toLowerCase() === parsed.name.toLowerCase() ||
        (this.platform === 'win32' && name.toLowerCase() === `${parsed.name.toLowerCase()}.exe`),
    )
    const candidate = matchingBin ?? (files.length === 1 ? files[0] : undefined)
    if (!candidate)
      throw new Error('uv installed multiple ACP executables without a matching package name')
    const executable = join(bin, candidate)
    const info = await stat(executable).catch(() => undefined)
    if (!info?.isFile()) throw new Error('Installed uv ACP executable was not found')
    if (this.platform !== 'win32') await chmod(executable, 0o700)
    return {
      command: executable,
      args: value.args ?? [],
      env: isSafeEnvironment(value.env),
    }
  }
}
