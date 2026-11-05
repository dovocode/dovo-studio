import { parentPort, workerData } from 'node:worker_threads'
import { Schema } from 'effect'
import { decode, mutableStruct, workspaceRouteRequestSchema } from '@dovo/protocol'
import { loadGliclassRouter } from './gliclass-router-inference.js'

const { directory } = decode(mutableStruct({ directory: Schema.String }), workerData)
const port = parentPort
if (!port) throw new Error('Workspace router needs a worker channel')
// Several paired clients can request suggestions; one model processes them in order.
let model: ReturnType<typeof loadGliclassRouter> | undefined
let queue = Promise.resolve()
port.on('message', (value: unknown) => {
  const { id } = decode(mutableStruct({ id: Schema.Number }), value)
  const request = decode(
    workspaceRouteRequestSchema,
    typeof value === 'object' && value !== null && 'text' in value
      ? {
          text: value.text,
          ...('mode' in value ? { mode: value.mode } : {}),
          ...('catalogs' in value ? { catalogs: value.catalogs } : {}),
        }
      : undefined,
  )
  queue = queue.then(async () => {
    try {
      const router = await (model ??= loadGliclassRouter(directory))
      port.postMessage({ id, ...(await router.route(request)) })
    } catch (error) {
      if (error instanceof RangeError) {
        port.postMessage({
          id,
          mode: 'thread',
          reason:
            'Input or choices exceed the local classifier limit. Thread is selected for review; you can override it.',
        })
      } else {
        console.error('GLiClass workspace routing failed', error)
        port.postMessage({ id, error: 'Local model unavailable' })
      }
    }
  })
})
