import { decode, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import type { CDPSession } from 'playwright'
import { HttpError } from '../errors.js'

const evaluationSchema = mutableStruct({
  result: mutableStruct({
    value: Schema.optional(Schema.Unknown),
    unserializableValue: Schema.optional(Schema.String),
  }),
  exceptionDetails: Schema.optional(
    mutableStruct({
      text: Schema.String,
      exception: Schema.optional(mutableStruct({ description: Schema.optional(Schema.String) })),
    }),
  ),
})

/** CDP bounds synchronous loops; the deadline also bounds unresolved promises. */
export async function browserScript(cdp: CDPSession, script: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  try {
    const evaluation: unknown = await Promise.race([
      cdp.send('Runtime.evaluate', {
        expression: script,
        awaitPromise: true,
        returnByValue: true,
        timeout: 10000,
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(new HttpError(408, 'Browser script exceeded the 10 second execution limit'))
        }, 10000)
      }),
    ])
    const { result, exceptionDetails } = decode(evaluationSchema, evaluation)
    if (exceptionDetails)
      throw new HttpError(400, exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value ?? result.unserializableValue ?? null
  } finally {
    clearTimeout(timer)
    if (timedOut) await cdp.send('Runtime.terminateExecution')
  }
}
