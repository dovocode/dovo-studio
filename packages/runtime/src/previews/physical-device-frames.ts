import { Dicer } from '@fastify/busboy'

export function physicalDeviceFrames(
  frame: (data: Buffer) => void,
  report: (error: Error) => void,
) {
  const parser = new Dicer({ boundary: 'dovo-frame' })
  let failed = false
  const fail = (error: Error) => {
    if (failed) return
    failed = true
    report(error)
    parser.destroy()
  }
  parser.on('error', fail)
  parser.on('part', (part) => {
    const chunks: Buffer[] = []
    let expected = 0
    let length = 0
    part.on('header', (headers) => {
      const values = 'content-length' in headers ? headers['content-length'] : undefined
      if (
        !Array.isArray(values) ||
        values.length !== 1 ||
        typeof values[0] !== 'string' ||
        !/^\d+$/.test(values[0])
      ) {
        fail(new Error('Invalid physical device frame length'))
        return
      }
      expected = Number(values[0])
      if (!Number.isSafeInteger(expected) || expected <= 0 || expected > 8 * 1024 * 1024)
        fail(new Error('Invalid physical device frame length'))
    })
    part.on('data', (chunk: Buffer) => {
      if (failed) return
      length += chunk.length
      if (length > expected) {
        fail(new Error('Physical device frame exceeds declared length'))
        return
      }
      chunks.push(chunk)
      // FFmpeg supplies Content-Length. Waiting for the multipart end event
      // holds this image until the NEXT image arrives, leaving still screens stale.
      if (length === expected) {
        frame(Buffer.concat(chunks, length))
        chunks.length = 0
      }
    })
    part.on('error', fail)
    part.on('end', () => {
      if (!failed && length !== expected) fail(new Error('Incomplete physical device frame'))
    })
  })
  return parser
}
