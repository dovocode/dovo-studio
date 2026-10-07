import { Schema } from 'effect'
import { decodeResult } from '@dovo/protocol'

const record = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
export const nativeObject = (value: unknown) => decodeResult(record, value).data ?? {}
export const nativeText = (value: unknown) => (typeof value === 'string' ? value : '')

/** A control deadline is distinct from the unbounded, cancellable model turn. */
export async function nativeWait<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeout?: number,
): Promise<T> {
  const controller = new AbortController()
  const timer =
    timeout === undefined
      ? undefined
      : setTimeout(() => controller.abort(new Error('Agent control request timed out')), timeout)
  const combined = AbortSignal.any([signal, controller.signal])
  try {
    return await new Promise<T>((resolve, reject) => {
      const abort = () => reject(combined.reason)
      if (combined.aborted) {
        void operation.catch(() => {})
        abort()
        return
      }
      combined.addEventListener('abort', abort, { once: true })
      operation.then(resolve, reject).finally(() => combined.removeEventListener('abort', abort))
    })
  } finally {
    clearTimeout(timer)
  }
}
