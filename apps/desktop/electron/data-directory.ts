import { existsSync } from 'node:fs'
import { join } from 'node:path'

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
