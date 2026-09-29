import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readlink, rename, rm, symlink } from 'node:fs/promises'
import { decode, snapshotSchema, type ServerUpdateStatus } from '@dovo/protocol'
import { readConnection } from './connection.js'
import { writePrivateJson } from './server-config.js'
import { updateService } from './server-service.js'

const execute = promisify(execFile)
const versionNumbers = (value: string) =>
  /^\d+\.\d+\.\d+(?:-nightly\.\d+)?$/.test(value)
    ? value.replace('-nightly.', '.').split('.').map(Number)
    : undefined
function isNewer(target: string, installed: string) {
  const next = versionNumbers(target),
    current = versionNumbers(installed)
  if (!next || !current) return false
  for (let index = 0; index < Math.max(next.length, current.length); index++) {
    const left = next[index] ?? Number.MAX_SAFE_INTEGER
    const right = current[index] ?? Number.MAX_SAFE_INTEGER
    if (left !== right) return left > right
  }
  return false
}
function status(directory: string, next: ServerUpdateStatus) {
  writePrivateJson(join(directory, 'server-update-status.json'), {
    ...next,
    updatedAt: new Date().toISOString(),
  })
}
function serviceLauncher(directory: string) {
  const record: unknown = JSON.parse(readFileSync(join(directory, 'server-service.json'), 'utf8'))
  if (
    !record ||
    typeof record !== 'object' ||
    !('launcher' in record) ||
    typeof record.launcher !== 'string'
  )
    throw new Error('A managed server service is required')
  return resolve(record.launcher)
}
export async function releaseAsset(version: string, channel: 'stable' | 'nightly') {
  const tag = `v${version}`
  const response = await fetch(
    `https://api.github.com/repos/dovocode/dovo-studio/releases/tags/${tag}`,
    {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw new Error(`Release ${tag} could not be checked (HTTP ${response.status})`)
  const release: unknown = await response.json()
  if (
    !release ||
    typeof release !== 'object' ||
    !('draft' in release) ||
    release.draft !== false ||
    !('prerelease' in release) ||
    release.prerelease !== (channel === 'nightly') ||
    !('assets' in release) ||
    !Array.isArray(release.assets)
  )
    throw new Error('Release metadata is incomplete or belongs to another channel')
  const prefix = channel === 'nightly' ? 'Dovo-Server-Nightly' : 'Dovo-Server'
  const name = `${prefix}-${version}-${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}.tar.gz`
  const asset: unknown = release.assets.find(
    (item: unknown) => item && typeof item === 'object' && 'name' in item && item.name === name,
  )
  if (
    !asset ||
    typeof asset !== 'object' ||
    !('browser_download_url' in asset) ||
    typeof asset.browser_download_url !== 'string' ||
    !('digest' in asset) ||
    typeof asset.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
    !('size' in asset) ||
    typeof asset.size !== 'number' ||
    asset.size <= 0 ||
    asset.size > 750_000_000
  )
    throw new Error(`A verified ${name} archive is unavailable`)
  if (
    asset.browser_download_url !==
    `https://github.com/dovocode/dovo-studio/releases/download/${tag}/${name}`
  )
    throw new Error('Release archive URL is unexpected')
  return { url: asset.browser_download_url, digest: asset.digest.slice(7), size: asset.size }
}
async function download(
  directory: string,
  version: string,
  target: string,
  asset: Awaited<ReturnType<typeof releaseAsset>>,
) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(10 * 60 * 1000) })
  if (!response.ok || !response.body)
    throw new Error(`Server download failed (HTTP ${response.status})`)
  const file = await open(target, 'wx', 0o600)
  const hash = createHash('sha256')
  let transferred = 0
  let reported = 0
  try {
    for await (const chunk of response.body) {
      transferred += chunk.byteLength
      if (transferred > asset.size) throw new Error('Server archive exceeded its published size')
      hash.update(chunk)
      let offset = 0
      while (offset < chunk.byteLength) {
        const result = await file.write(chunk, offset, chunk.byteLength - offset)
        offset += result.bytesWritten
      }
      if (Date.now() - reported > 250) {
        status(directory, {
          status: 'downloading',
          version,
          progress: (transferred / asset.size) * 100,
          transferred,
          total: asset.size,
        })
        reported = Date.now()
      }
    }
  } finally {
    await file.close()
  }
  if (transferred !== asset.size || hash.digest('hex') !== asset.digest)
    throw new Error('Server archive did not match its published SHA-256 digest')
  status(directory, {
    status: 'downloading',
    version,
    progress: 100,
    transferred,
    total: asset.size,
  })
}
async function prepareRestart(directory: string) {
  const connection = readConnection(join(directory, 'runtime-connection.json'))
  const headers = { Authorization: `Bearer ${connection.token}` }
  const response = await fetch(`${connection.address}/api/snapshot`, {
    headers,
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('The running server could not be checked before restart')
  const snapshot = decode(snapshotSchema, await response.json())
  if (
    snapshot.workspace.tasks.some((task) => task.status === 'running') ||
    snapshot.runs.some((run) => run.status === 'running')
  )
    throw new Error('Finish running tasks and automations before updating this server')
  const lease = await fetch(`${connection.address}/api/runtime/prepare-restart`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  })
  if (!lease.ok) throw new Error(`Server could not prepare for restart (HTTP ${lease.status})`)
  const value: unknown = await lease.json()
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string')
    throw new Error('Server restart response was invalid')
  return async () => {
    await fetch(`${connection.address}/api/runtime/cancel-restart`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: value.id }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
  }
}
async function verifyInstalled(directory: string, version: string) {
  const connection = readConnection(join(directory, 'runtime-connection.json'))
  const response = await fetch(`${connection.address}/api/snapshot`, {
    headers: { Authorization: `Bearer ${connection.token}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('Updated server did not respond')
  const snapshot = decode(snapshotSchema, await response.json())
  if (snapshot.releaseVersion !== version)
    throw new Error(
      `Server restarted with ${snapshot.releaseVersion ?? 'an unknown version'} instead of ${version}`,
    )
}

export async function runRemoteServerUpdate(directory: string, version: string) {
  try {
    if (
      process.env.DOVO_SERVER_DISTRIBUTION !== 'archive' ||
      !/^\d+\.\d+\.\d+(?:-nightly\.\d+)?$/.test(version)
    )
      throw new Error('This server cannot install that release')
    if (process.env.DOVO_RELEASE_VERSION && !isNewer(version, process.env.DOVO_RELEASE_VERSION))
      throw new Error('The selected release is not newer than this server')
    const current = serviceLauncher(directory)
    const channel = version.includes('-nightly.') ? 'nightly' : 'stable'
    const name = channel === 'nightly' ? 'dovo-server-nightly' : 'dovo-server'
    if (basename(current) !== name) throw new Error('The update channel does not match this server')
    if (process.platform === 'darwin') {
      if (!['/opt/homebrew/bin', '/usr/local/bin'].includes(resolve(current, '..')))
        throw new Error('Update this Mac server using its original package manager')
      status(directory, { status: 'installing', version })
      const release = await releaseAsset(version, channel)
      if (!release) throw new Error('Release is unavailable')
      const cancel = await prepareRestart(directory)
      try {
        await updateService(directory)
        await verifyInstalled(directory, version)
      } catch (error) {
        await cancel()
        throw error
      }
    } else if (process.platform === 'linux') {
      const root = join(homedir(), '.local', 'share', 'dovo', 'server', channel)
      if (!current.startsWith(root + '/'))
        throw new Error('Update this Linux server using its original installer')
      const asset = await releaseAsset(version, channel)
      const destination = join(root, `v${version}`)
      const launcher = join(destination, 'bin', name)
      let stage: string | undefined
      try {
        if (!existsSync(launcher)) {
          await mkdir(root, { recursive: true })
          stage = await mkdtemp(join(root, '.dovo-update-'))
          const archive = join(stage, 'server.tar.gz')
          await download(directory, version, archive, asset)
          const extracted = join(stage, 'extracted')
          await mkdir(extracted)
          await execute('tar', ['-xzf', archive, '-C', extracted], { timeout: 120000 })
          const candidate = join(extracted, 'bin', name)
          if (!existsSync(candidate)) throw new Error('Server archive has no launcher')
          await execute(candidate, ['--help'], { timeout: 15000 })
          await rename(extracted, destination)
        }
        status(directory, { status: 'installing', version, progress: 100 })
        const cancel = await prepareRestart(directory)
        try {
          await updateService(directory, launcher)
          await verifyInstalled(directory, version)
        } catch (error) {
          await cancel()
          throw error
        }
        const shortcut = join(homedir(), '.local', 'bin', name)
        if (
          await lstat(shortcut).then(
            (entry) => entry.isSymbolicLink(),
            () => false,
          )
        ) {
          const previous = await readlink(shortcut)
          if (resolve(join(shortcut, '..'), previous).startsWith(root + '/')) {
            const temporary = `${shortcut}.${process.pid}.tmp`
            await symlink(launcher, temporary)
            await rename(temporary, shortcut)
          }
        }
      } finally {
        if (stage) await rm(stage, { recursive: true, force: true })
      }
    } else throw new Error('In-app server updates are not available on this platform')
    status(directory, { status: 'complete', version, progress: 100 })
    return { updated: true, version }
  } catch (error) {
    status(directory, {
      status: 'error',
      version,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
