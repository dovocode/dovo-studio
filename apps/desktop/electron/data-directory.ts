import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface DesktopProfile {
  directory: string
  configured: boolean
}

export function desktopProfile(directory: string): DesktopProfile {
  return {
    directory,
    configured: [
      'runtime.sqlite',
      'runtime.sqlite-wal',
      'runtime-connection.json',
      'runtime-listen.json',
      'runtime-connections.enc',
      'runtime-process.lock',
      'server.json',
      'server-release.json',
      'server-process.json',
      'owner-token',
    ].some((name) => existsSync(join(directory, name))),
  }
}

// Packaging changes Electron's default profile name. Reuse the established workspace
// without copying its credentials, unless this launch already has its own profile.
export function selectDesktopDataDirectory(options: {
  packaged: boolean
  explicitDirectory: boolean
  current: DesktopProfile
  legacy: DesktopProfile
  shared?: DesktopProfile
}): string {
  const { packaged, explicitDirectory, current, legacy, shared } = options
  if (packaged && !explicitDirectory && shared)
    return shared.configured
      ? shared.directory
      : legacy.configured
        ? legacy.directory
        : shared.directory
  return packaged && !explicitDirectory && !current.configured && legacy.configured
    ? legacy.directory
    : current.directory
}

/** Move the whole Electron profile only after its supervised runtime has stopped. */
export function migrateDesktopDataDirectory(
  source: string,
  target: string,
  stopRuntime: (source: string) => void,
) {
  if (source === target) return target
  if (desktopProfile(target).configured) {
    if (desktopProfile(source).configured)
      throw new Error('Both desktop data directories contain a workspace')
    return target
  }
  if (!desktopProfile(source).configured) {
    mkdirSync(target, { recursive: true, mode: 0o700 })
    return target
  }
  if (existsSync(target)) {
    if (readdirSync(target).length)
      throw new Error('The new desktop data directory already has files')
    rmdirSync(target)
  }
  stopRuntime(source)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  renameSync(source, target)
  return target
}
