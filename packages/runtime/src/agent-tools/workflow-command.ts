import { decode, workflowCommandSchema } from '@dovo/protocol/agent-tools'

/** Accept encoded plan metadata without changing the canonical plan command. */
export function workflowCommand(input: Record<string, unknown>) {
  let phases: unknown = input.phases
  if (typeof phases === 'string') {
    try {
      phases = JSON.parse(phases)
    } catch (cause) {
      throw new Error('Workflow phases must contain a valid JSON array.', { cause })
    }
  }
  return decode(workflowCommandSchema, {
    ...input,
    ...(phases === undefined ? {} : { phases }),
  })
}
