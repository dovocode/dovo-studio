import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { connectPage, connectPageStyles } from './pages.js'

export const hostedStylesHash = createHash('sha256').update(connectPageStyles).digest('base64')

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
  r.end(connectPage(content))
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
