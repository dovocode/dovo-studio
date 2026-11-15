import { decode, responsePrepareCommandSchema } from '@dovo/protocol/agent-tools'

/** Normalize the action metadata encoded by some model APIs. Review and
 * execution still use the canonical, strictly validated command. */
export function responsePrepareCommand(input: Record<string, unknown>) {
  let action: unknown = input.action
  if (typeof action === 'string') {
    try {
      action = JSON.parse(action)
    } catch (cause) {
      throw new Error('Response action must contain a valid JSON object.', { cause })
    }
  }
  return decode(responsePrepareCommandSchema, { ...input, action })
}
