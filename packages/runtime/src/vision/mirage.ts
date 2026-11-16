import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { VisionInput } from './schema.js'

let active = 0
export async function analyzeMirage(image: Uint8Array, input: VisionInput, signal: AbortSignal) {
  signal.throwIfAborted()
  if (active >= 2) throw new Error('Local vision is busy. Wait for the current analysis to finish.')
  if (image.byteLength > 16 * 1024 * 1024) throw new Error('Choose an image up to 16 MB')
  active++
  const adjacent = new URL('./mirage-worker.js', import.meta.url)
  const script = existsSync(adjacent)
    ? adjacent
    : new URL('../../dist/vision/mirage-worker.js', import.meta.url)
  const directory = fileURLToPath(new URL('./assets/', script))
  if (!existsSync(new URL('manifest.json', new URL('./assets/', script)))) {
    active--
    throw new Error(
      'Bundled Mirage assets are missing. Build the Studio runtime to prepare local vision.',
    )
  }
  let worker: Worker | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => {}
  try {
    return await new Promise<unknown>((resolve, reject) => {
      worker = new Worker(script, {
        workerData: { directory, image, input },
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      })
      abort = () => reject(new Error('Local vision cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) return abort()
      timeout = setTimeout(() => reject(new Error('Local vision timed out')), 120000)
      worker.once('error', reject)
      worker.once('exit', (code) =>
        reject(new Error(`Local vision worker exited before returning a result (${code})`)),
      )
      worker.once('message', (message: unknown) => {
        const parsed = z
          .union([
            z.object({ result: z.record(z.string(), z.unknown()) }),
            z.object({ error: z.string() }),
          ])
          .safeParse(message)
        if (!parsed.success) return reject(new Error('Invalid local vision response'))
        if ('error' in parsed.data) reject(new Error(parsed.data.error))
        else resolve(parsed.data.result)
      })
    })
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    try {
      await worker?.terminate()
    } finally {
      active--
    }
  }
}
