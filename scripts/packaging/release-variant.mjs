import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function releaseVariant(root) {
  const sourceVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
  const version = process.env.DOVO_RELEASE_VERSION || sourceVersion
  if (!/^\d+\.\d+\.\d+(?:-nightly\.\d+)?$/.test(version))
    throw new Error(`Invalid release version: ${version}`)
  const nightly = version.includes('-nightly.')
  if (
    process.env.DOVO_RELEASE_CHANNEL &&
    process.env.DOVO_RELEASE_CHANNEL !== (nightly ? 'nightly' : 'stable')
  )
    throw new Error('Release channel and version disagree')
  return {
    version,
    nightly,
    productName: nightly ? 'Dovo Studio (Nightly)' : 'Dovo Studio',
    appId: nightly ? 'com.dovo.studio.nightly' : 'com.dovo.studio',
    artifactPrefix: nightly ? 'Dovo-Studio-Nightly' : 'Dovo-Studio',
  }
}
