import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVariant } from './release-variant.mjs'
import { gpuiTargets } from './gpui-targets.mjs'

export function gpuiReleaseAssets({ version, nightly, platforms = 'all' }) {
  const prefix = `Dovo-GPUI${nightly ? '-Nightly' : ''}-${version}`
  return gpuiTargets(platforms)
    .flatMap(({ os, arch }) => [
      `${prefix}-${os}-${arch}.${os === 'windows' ? 'zip' : 'tar.gz'}`,
      ...(os === 'linux'
        ? [
            `${prefix}-linux-${arch === 'x64' ? 'amd64' : 'arm64'}.deb`,
            `${prefix}-linux-${arch === 'x64' ? 'x86_64' : 'aarch64'}.rpm`,
          ]
        : []),
    ])
    .sort()
}

export async function verifyGpuiRelease(directory, variant) {
  const expected = gpuiReleaseAssets(variant)
  const files = await readdir(directory)
  for (const file of expected)
    if (!files.includes(file)) throw new Error(`Missing GPUI release asset: ${file}`)
  const sums = []
  for (const file of expected) {
    const bytes = await readFile(join(directory, file))
    if (!bytes.length) throw new Error(`Empty GPUI release asset: ${file}`)
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`)
  }
  const manifest = `Dovo-GPUI${variant.nightly ? '-Nightly' : ''}-${variant.version}-SHA256SUMS.txt`
  await writeFile(join(directory, manifest), `${sums.join('\n')}\n`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  console.log(
    await verifyGpuiRelease(join(root, 'release'), {
      ...(await releaseVariant(root)),
      platforms: process.env.DOVO_GPUI_PLATFORMS || 'all',
    }),
  )
}
