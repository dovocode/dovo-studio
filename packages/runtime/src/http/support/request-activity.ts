import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Activity } from '../../storage/activity.js'
import { observeBody } from './body.js'
// Large bodies (whole conversations in a message PATCH, imports, webhook payloads) would be
// copied into every activity row. Record their size instead of their contents.
const MAX_RECORDED_INPUT = 16 * 1024
function recordedInput(value: unknown) {
  const size = JSON.stringify(value ?? null).length
  return size > MAX_RECORDED_INPUT ? { omitted: 'Request body too large to record', size } : value
}
const completions = new WeakMap<IncomingMessage, (status: number, error?: string) => void>()
export function trackRequest(
  request: IncomingMessage,
  activity: Activity,
  scope: string,
  summary: string,
  captureInput = true,
) {
  const id = randomUUID()
  let input: unknown = {}
  activity.add('integration', scope, summary, { status: 'received' }, id)
  observeBody(request, (value) => {
    input = captureInput ? recordedInput(value) : '[sensitive input not recorded]'
    activity.add('integration', scope, summary, { status: 'received', input }, id)
  })
  completions.set(request, (status, error) => {
    activity.add('integration', scope, summary, { input, status, error }, id)
  })
}
export function completeRequest(request: IncomingMessage, status: number, error?: string) {
  completions.get(request)?.(status, error)
  completions.delete(request)
}
