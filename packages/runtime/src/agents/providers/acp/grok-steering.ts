import { isImageAttachment } from '@dovo/protocol'
import { Schema } from 'effect'
import type { AgentRun, AgentSteer } from '../../execution/types.js'

const queued = Schema.is(
  Schema.Struct({ result: Schema.Struct({ status: Schema.Literal('queued') }) }),
)

/** Grok queues input without cancelling the foreground tool. Acceptance is delivery. */
export function grokSteering(
  run: AgentRun,
  sessionId: string,
  active: () => boolean,
  request: (params: {
    sessionId: string
    text: string
    content?: Array<{ type: 'image'; data: string; mimeType: string }>
  }) => Promise<unknown>,
): AgentSteer {
  return async (input) => {
    run.signal.throwIfAborted()
    if (!active()) throw new Error('This Grok turn has ended')
    const images = (input.attachments ?? []).filter(isImageAttachment).map((file) => ({
      type: 'image' as const,
      data: file.data,
      mimeType: file.mime,
    }))
    const response = await request({
      sessionId,
      text: input.prompt,
      ...(images.length ? { content: images } : {}),
    })
    if (!queued(response)) throw new Error('Grok did not queue the interjection')
  }
}
