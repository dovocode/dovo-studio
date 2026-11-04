import { parentPort, workerData } from 'node:worker_threads'
import { Schema } from 'effect'
import { decode, mutableStruct, workspaceRouteRequestSchema } from '@dovo/protocol'
import { loadJuliaRouter } from './julia-router-inference.js'

const { directory } = decode(mutableStruct({ directory: Schema.String }), workerData)
const port = parentPort
if (!port) throw new Error('Workspace router needs a worker channel')
// Several paired clients can request suggestions; one model processes them in order.
let model: ReturnType<typeof loadJuliaRouter> | undefined
let queue = Promise.resolve()
port.on('message', (value: unknown) => {
  const { id } = decode(mutableStruct({ id: Schema.Number }), value)
  const { text } = decode(
    workspaceRouteRequestSchema,
    typeof value === 'object' && value !== null && 'text' in value
      ? { text: value.text }
      : undefined,
  )
  queue = queue.then(async () => {
    try {
      const router = await (model ??= loadJuliaRouter(directory))
      port.postMessage({ id, ...(await router.route(text)) })
    } catch (error) {
      console.error('Julia-1 workspace routing failed', error)
      port.postMessage({ id, error: 'Local model unavailable' })
    }
  })
})
