import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { releaseDownloader } from './github-release-download.mjs'

export const routerModel = {
  name: 'Dovo GLiClass run-09',
  repository: 'knowledgator/gliclass-base-v3.0',
  revision: '77a70e6cd52e602ed18184ef37d18bdd3741e3d5',
  baseUrl:
    'https://github.com/dovocode/dovo-studio/releases/download/workspace-router-gliclass-20261104-r09',
  files: [
    {
      name: 'LICENSE-APACHE-2.0.txt',
      size: 11358,
      sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
    },
    {
      name: 'LICENSE-DEBERTA-MIT.txt',
      size: 1141,
      sha256: 'c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383',
    },
    {
      name: 'LICENSE-TOKENIZERS.txt',
      size: 11357,
      sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
    },
    {
      name: 'NOTICE.txt',
      size: 772,
      sha256: '98698ccdb5c31573e5a0d6a2384ff3bf618f17bef02545c37de67c48e9154014',
    },
    {
      name: 'README.md',
      size: 2795,
      sha256: 'bdf6a5d07eb59b7fbcbd3ee45401bfe500808cffa642715c798deab223dd82b0',
    },
    {
      name: 'config.json',
      size: 3752,
      sha256: 'a3f2055042b9baeaf32a6f105959614d00049e470efe30a1cffa3b2ef785efc7',
    },
    {
      name: 'model.onnx',
      size: 197828922,
      sha256: '281661098f4ef538d75f7233c9dcc2c9bbba719586cf98e3c4b18a371584922c',
    },
    {
      name: 'routing.json',
      size: 3444,
      sha256: '8d41875c087120ee813834b53f87cba25f9421dbfde83acf23263fd2769773ef',
    },
    {
      name: 'tokenizer.json',
      size: 8332640,
      sha256: 'f600de7df2f264c0a832209d2984d512f956e77b8ec80a90914b794ebb27713c',
    },
    {
      name: 'tokenizer.mjs',
      size: 98937,
      sha256: '1c4a848f86156201c033d6cd08c4cf81ae1088552acec3367f31ef086edf5af0',
    },
    {
      name: 'tokenizer_config.json',
      size: 635,
      sha256: '2fcf7b3f79e70fc1671316cc32fbc72f91b5fe8bf0f95806f6f831e0cd74795e',
    },
  ],
}
async function valid(file, expected) {
  try {
    if ((await stat(file)).size !== expected.size) return false
    const hash = createHash('sha256')
    for await (const bytes of createReadStream(file)) hash.update(bytes)
    return hash.digest('hex') === expected.sha256
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
/** Build-time only. Release bundles contain verified weights; inference never downloads them. */
export async function prepareWorkspaceRouterModel(directory, model = routerModel) {
  const download = releaseDownloader(model.baseUrl)
  for (const file of model.files) {
    const destination = join(directory, file.name)
    if (await valid(destination, file)) continue
    await mkdir(dirname(destination), { recursive: true })
    const temporary = destination + '.' + randomUUID() + '.tmp'
    try {
      console.log(`Preparing bundled workspace router: ${file.name}`)
      const response = await download(file.name)
      if (!response.ok || !response.body)
        throw new Error(`Could not fetch workspace model ${file.name}: HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }))
      if (!(await valid(temporary, file)))
        throw new Error(`Workspace model checksum mismatch: ${file.name}`)
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  // Remove only known Julia assets after the complete replacement has been verified.
  for (const obsolete of [
    'model.onnx.data',
    'wasm/julia_webgpu_encode.js',
    'wasm/julia_webgpu_encode_bg.wasm',
    'parity-cases.json',
    'LICENSE',
    'NOTICE.md',
  ])
    await rm(join(directory, obsolete), { force: true })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await prepareWorkspaceRouterModel(
    fileURLToPath(new URL('../../packages/runtime/dist/models/workspace-router/', import.meta.url)),
  )
