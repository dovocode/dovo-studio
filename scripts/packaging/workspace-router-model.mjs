import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, copyFile, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const routerModel = {
  name: 'Julia-1',
  repository: 'SupersonicLabs/Julia-1-ONNX',
  revision: '82a2fadf8fccfccdc5fd4e1009ba8f1a265eb7a8',
  files: [
    {
      name: 'model.onnx.data',
      size: 576782336,
      sha256: 'fd915be810d7ebfb80fb05a48dd33c9484d17ae1b6bcb9e1f544cbaaa913ded1',
    },
    {
      name: 'model.onnx',
      size: 2988923,
      sha256: '97141d0cfb1da6204e9f8f24d581af72eaeb82cda21149d83eaa6df7160fbcd9',
    },
    {
      name: 'tokenizer.json',
      size: 34363188,
      sha256: '609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f',
    },
    {
      name: 'tokenizer_config.json',
      size: 652,
      sha256: '6b069e57db0ce0794c22547725275f22618809c4ef4249307337e651a0dfef8c',
    },
    {
      name: 'wasm/julia_webgpu_encode.js',
      size: 9482,
      sha256: '1b33508498fb860862c7a6cffb11dbfab6a9cea2969e1c85f1c3bdb61793c8d6',
    },
    {
      name: 'wasm/julia_webgpu_encode_bg.wasm',
      size: 2839690,
      sha256: '6bd07351de6809f6d41e9f28a46a35bbc50866872a6dd63498a7a8f611998421',
    },
    {
      name: 'parity-cases.json',
      size: 53278,
      sha256: '534670f25823f3f9abf9e812500918fabc606682dfd4e2456d827889d9bdca20',
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
  for (const file of model.files) {
    const destination = join(directory, file.name)
    if (await valid(destination, file)) continue
    await mkdir(dirname(destination), { recursive: true })
    const temporary = destination + '.' + randomUUID() + '.tmp'
    try {
      console.log(`Preparing bundled workspace router: ${file.name}`)
      const response = await fetch(
        `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.name}`,
        { signal: AbortSignal.timeout(600_000) },
      )
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
  await mkdir(directory, { recursive: true })
  await copyFile(
    new URL('./workspace-router-LICENSE.txt', import.meta.url),
    join(directory, 'LICENSE'),
  )
  await writeFile(
    join(directory, 'NOTICE.md'),
    `Bundled routing model: ${model.name}\nONNX weights: https://huggingface.co/${model.repository}/tree/${model.revision}\nUpstream: https://huggingface.co/SupersonicLabs/Julia-1\nLicense: Apache-2.0 (see LICENSE).\nInference: full FP32 decision graph with ONNX Runtime CPU and the authors’ strict Rust/WASM tokenizer.\n`,
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await prepareWorkspaceRouterModel(
    fileURLToPath(new URL('../../packages/runtime/dist/models/workspace-router/', import.meta.url)),
  )
