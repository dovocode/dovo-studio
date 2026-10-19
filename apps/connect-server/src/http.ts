import type { IncomingMessage, ServerResponse } from 'node:http'

export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const json = (r: ServerResponse, status: number, data: unknown) => {
  r.writeHead(status, { 'Content-Type': 'application/json' })
  r.end(JSON.stringify(data))
}
export const html = (r: ServerResponse, status: number, content: string) => {
  r.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  r.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dovo Studio sign-in</title><body><main><h1>Dovo Studio</h1>${content}</main></body></html>`,
  )
}
export const readJson = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16_384) throw new RequestError(413, 'Request is too large')
    chunks.push(Buffer.from(chunk))
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown
  } catch {
    throw new RequestError(400, 'Invalid request')
  }
}
export const bearerToken = (req: IncomingMessage) =>
  req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? ''
