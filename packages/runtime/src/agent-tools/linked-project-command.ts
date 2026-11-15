import { decode, linkedProjectsCommandSchema } from '@dovo/protocol/agent-tools'

/** Normalize this known metadata field for models that encode nested arguments. */
export function linkedProjectCommand(input: Record<string, unknown>) {
  let checkout: unknown = input.checkout
  if (typeof checkout === 'string') {
    try {
      checkout = JSON.parse(checkout)
    } catch (cause) {
      throw new Error('Linked checkout must contain a valid JSON object.', { cause })
    }
  }
  // The advertised JSON schema permits null for these optional fields. Treat
  // that wire representation as omission; required fields still reject null.
  if (checkout && typeof checkout === 'object' && !Array.isArray(checkout)) {
    checkout = Object.fromEntries(
      Object.entries(checkout).filter(
        ([key, value]) =>
          value !== null || !['existingWorktreePath', 'baseBranch', 'branch'].includes(key),
      ),
    )
  }
  return decode(linkedProjectsCommandSchema, {
    ...input,
    ...(checkout === undefined ? {} : { checkout }),
  })
}
