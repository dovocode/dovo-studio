import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Activity } from '../storage/activity.js'
import { observeBody } from './body.js'
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
    input = captureInput ? value : '[sensitive input not recorded]'
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
