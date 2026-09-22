export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
