import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import timers from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const engine =
  'https://huggingface.co/Cactus-Compute/cactus/resolve/1a028f5a3972b67dd8d8752f882113d475e7ec4c/releases/4.0.0'
export const mirageAssets = [
  {
    name: 'cactus.cjs',
    url: `${engine}/wasm/cactus.js`,
    bytes: 63150,
    sha256: 'bb61bcf0c48712bfb9cd0ade8f0748889dfde9944ac308220f42afbc605f82bc',
  },
  {
    name: 'cactus.wasm',
    url: `${engine}/wasm/cactus.wasm`,
    bytes: 1241703,
    sha256: '4198b30795ded7739fe6c9e80bf26d5a844767c081574d40c8dc0487cde8b4b6',
  },
  {
    name: 'LICENSE',
    url: `${engine}/LICENSE`,
    bytes: 11358,
    sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  },
  {
    name: 'mirage.cact',
    url: 'https://huggingface.co/Cactus-Compute/mirage/resolve/3d03cee88c0acbe4e71b94b567ab14e6e55f40c9/mirage.cact',
    bytes: 21611043,
    sha256: '4249a0f7515272ff76b9414bec17d7e7daf84b15b66c7fb4f17fce1e66f9f237',
  },
]
export function verifyMirageAsset(bytes, asset) {
  return (
    bytes.length === asset.bytes &&
    createHash('sha256').update(bytes).digest('hex') === asset.sha256
  )
}
export async function prepareMirage(root) {
  const directory = join(root, 'work/mirage/4.0.0')
  await mkdir(directory, { recursive: true })
  for (const asset of mirageAssets) {
    const filename = join(directory, asset.name)
    try {
      if (verifyMirageAsset(await readFile(filename), asset)) continue
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const download = () => fetch(asset.url, { signal: AbortSignal.timeout(120000) })
    let response = await download()
    if (response.status === 429) {
      // Hugging Face reports seconds to reset within a five-minute window.
      const rateLimit = response.headers.get('ratelimit') ?? ''
      const reset = /(?:^|;)\s*t=(\d+)\b/.exec(rateLimit)?.[1]
      const delaySeconds = Math.max(1, Number(reset ?? 300))
      if (delaySeconds <= 300) {
        await response.body?.cancel()
        console.warn(`Mirage ${asset.name} download rate limited. Retrying in ${delaySeconds}s.`)
        await timers.setTimeout(delaySeconds * 1000)
        response = await download()
      }
    }
    if (!response.ok)
      throw new Error(`Mirage ${asset.name} download failed: HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!verifyMirageAsset(bytes, asset))
      throw new Error(`Mirage ${asset.name} size or SHA-256 mismatch`)
    const temporary = `${filename}.${process.pid}.tmp`
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, filename)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(mirageAssets, null, 2) + '\n')
  await writeFile(
    join(directory, 'NOTICE'),
    `Cactus Mirage vision model and Cactus runtime 4.0.0\nCactus Compute. Licensed under Apache License 2.0.\nRuntime: https://github.com/cactus-compute/cactus\nModel: https://huggingface.co/Cactus-Compute/mirage\nThe unmodified runtime JavaScript is named cactus.cjs for CommonJS module loading.\nModel revision: 3d03cee88c0acbe4e71b94b567ab14e6e55f40c9\nRuntime revision: 1a028f5a3972b67dd8d8752f882113d475e7ec4c\n`,
  )
  return directory
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(await prepareMirage(fileURLToPath(new URL('../../', import.meta.url))))
