export function resourceError(error: unknown): string {
  if (error instanceof Error && 'issues' in error && Array.isArray(error.issues)) {
    const messages = error.issues.flatMap((issue: unknown) =>
      issue && typeof issue === 'object' && 'message' in issue && typeof issue.message === 'string'
        ? [issue.message]
        : [],
    )
    if (messages.length) return [...new Set(messages)].join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}
