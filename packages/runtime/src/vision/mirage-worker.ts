import { fileTypeFromBuffer } from 'file-type'
import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import sharp from 'sharp'
import { visionSchema, visionOptions } from './schema.js'

const requestSchema = z.object({
  directory: z.string(),
  image: z.instanceof(Uint8Array),
  input: visionSchema,
})
async function run() {
  const { directory, image, input } = requestSchema.parse(workerData)
  const format = await fileTypeFromBuffer(image)
  if (
    !format ||
    ![
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'image/avif',
      'image/heic',
      'image/heif',
      'image/tiff',
    ].includes(format.mime)
  )
    throw new Error('Choose a supported raster image format')
  const manifest = z
    .array(
      z.object({
        name: z.enum(['cactus.cjs', 'cactus.wasm', 'mirage.cact', 'LICENSE']),
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')))
  const assets = new Map<string, Buffer>()
  for (const name of ['cactus.cjs', 'cactus.wasm', 'mirage.cact']) {
    const asset = manifest.find((asset) => asset.name === name)
    if (!asset) throw new Error(`Missing Mirage asset: ${name}`)
    const bytes = await readFile(join(directory, name))
    if (
      bytes.length !== asset.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== asset.sha256
    )
      throw new Error(`Mirage ${name} checksum mismatch. Repair this Studio installation.`)
    assets.set(name, bytes)
  }
  const get = (name: string) => {
    const value = assets.get(name)
    if (!value) throw new Error(`Missing Mirage ${name}`)
    return value
  }
  const factory: unknown = createRequire(import.meta.url)(join(directory, 'cactus.cjs'))
  if (typeof factory !== 'function') throw new Error('Invalid Mirage runtime module')
  const module = z
    .custom<Record<string, unknown>>(
      (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    )
    .parse(await factory({ wasmBinary: get('cactus.wasm') }))
  // Keep the original heap getter. Emscripten replaces HEAPU8 when memory grows.
  const heap = () => z.instanceof(Uint8Array).parse(module.HEAPU8)
  const malloc = z.function({ input: [z.number()], output: z.number() }).parse(module._malloc)
  const free = z.function({ input: [z.number()], output: z.void() }).parse(module._free)
  const text = z.function({ input: [z.number()], output: z.string() }).parse(module.UTF8ToString)
  const lastError = z.function({ input: [], output: z.number() }).parse(module._cactus_last_error)
  const load = z
    .function({ input: [z.number(), z.bigint()], output: z.number() })
    .parse(module._cactus_load)
  const models = z.function({ input: [], output: z.number() }).parse(module._cactus_models)
  const describe = z
    .function({
      input: [
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
        z.number(),
      ],
      output: z.number(),
    })
    .parse(module._cactus_describe)
  const allocated: number[] = []
  const allocate = (bytes: Uint8Array) => {
    const pointer = malloc(bytes.length)
    if (!pointer) throw new Error('Mirage memory allocation failed')
    allocated.push(pointer)
    heap().set(bytes, pointer)
    return pointer
  }
  try {
    const weights = get('mirage.cact')
    if (load(allocate(weights), BigInt(weights.length)) < 0 || !(models() & 4))
      throw new Error(text(lastError()) || 'Mirage model could not load')
    const { data, info } = await sharp(image, { limitInputPixels: 20_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 3) throw new Error('Mirage requires RGB image data')
    const string = (value: string) => allocate(Buffer.from(value + '\0'))
    const capacity = 4 * 1024 * 1024
    const output = malloc(capacity)
    if (!output) throw new Error('Mirage output allocation failed')
    allocated.push(output)
    const started = performance.now()
    const length = describe(
      allocate(data),
      info.width,
      info.height,
      string(JSON.stringify(visionOptions(input))),
      input.language ? string(input.language) : 0,
      input.keywords?.length ? string(input.keywords.join('\n')) : 0,
      output,
      capacity,
    )
    if (length < 0) throw new Error(text(lastError()) || 'Mirage inference failed')
    const result: unknown = JSON.parse(text(output))
    return {
      model: 'Cactus Mirage',
      runtime: '4.0.0',
      local: true,
      action: input.action,
      image: { width: info.width, height: info.height },
      coordinateScale: 1000,
      elapsedMs: Math.round(performance.now() - started),
      result,
    }
  } finally {
    for (const pointer of allocated.reverse()) free(pointer)
  }
}
void run().then(
  (result) => parentPort?.postMessage({ result }),
  (error) =>
    parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }),
)
