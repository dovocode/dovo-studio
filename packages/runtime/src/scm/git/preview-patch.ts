import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

const modulePath = createRequire(import.meta.url).resolve('diff')
let active = 0
const MAX_ACTIVE = 2

export async function previewPatch(path: string, before: string, after: string) {
  if (active >= MAX_ACTIVE) return undefined
  active++
  try {
    return await new Promise<string | undefined>((resolve) => {
      let worker: Worker
      try {
        worker = new Worker(
          `const { parentPort, workerData } = require('node:worker_threads');
           try {
             const { createTwoFilesPatch } = require(workerData.modulePath);
             parentPort.postMessage(createTwoFilesPatch(workerData.path, workerData.path, workerData.before, workerData.after, undefined, undefined, { timeout: 1000 }));
           } catch { parentPort.postMessage(null); }`,
          {
            eval: true,
            execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
            workerData: { modulePath, path, before, after },
          },
        )
      } catch {
        resolve(undefined)
        return
      }
      let done = false
      const timer = setTimeout(() => finish(undefined), 2000)
      const finish = (patch: string | undefined) => {
        if (done) return
        done = true
        clearTimeout(timer)
        void worker.terminate().then(
          () => resolve(patch),
          () => resolve(patch),
        )
      }
      worker.once('message', (patch: unknown) =>
        finish(typeof patch === 'string' ? patch : undefined),
      )
      worker.once('error', () => finish(undefined))
      worker.once('exit', () => finish(undefined))
    })
  } finally {
    active--
  }
}
