/** Preserve raw terminal data. Submission appends one actual carriage return. */
export function terminalInputData(input: Record<string, unknown>): string {
  if (typeof input.data !== 'string') throw new Error('Expected terminal data to be a string')
  if (input.submit !== undefined && typeof input.submit !== 'boolean')
    throw new Error('Expected terminal submit to be a boolean')
  return input.data + (input.submit === true ? '\r' : '')
}
