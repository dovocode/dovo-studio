import { decode, secureInputCommandSchema } from '@dovo/protocol/agent-tools'

/** Some model APIs encode nested tool arguments as JSON strings. Normalize only
 * this known metadata field. The private credential never enters tool arguments. */
export function secureInputCommand(input: Record<string, unknown>) {
  let destination: unknown = input.destination
  if (typeof destination === 'string') {
    try {
      destination = JSON.parse(destination)
    } catch (cause) {
      throw new Error('Secure input destination must contain a valid JSON object.', { cause })
    }
  }
  return decode(secureInputCommandSchema, {
    ...input,
    ...(destination === undefined ? {} : { destination }),
  })
}
