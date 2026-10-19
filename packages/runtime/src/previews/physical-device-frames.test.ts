import { expect, it, vi } from 'vite-plus/test'
import { physicalDeviceFrames } from './physical-device-frames'

function packet(data: Buffer) {
  return Buffer.concat([
    Buffer.from(
      `--dovo-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${data.length}\r\n\r\n`,
    ),
    data,
    Buffer.from('\r\n'),
  ])
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

it('publishes a complete image without waiting for a subsequent image or end of stream', async () => {
  const received = vi.fn<(data: Buffer) => void>(),
    error = vi.fn<(error: Error) => void>()
  const parser = physicalDeviceFrames(received, error)
  const data = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9])
  parser.write(packet(data))
  await tick()
  expect(received.mock.calls).toEqual([[data]])
  expect(error).not.toHaveBeenCalled()
  expect(parser.writableEnded).toBe(false)
  parser.destroy()
})

it('reassembles fragmented headers and images and publishes each image once', async () => {
  const received = vi.fn<(data: Buffer) => void>(),
    error = vi.fn<(error: Error) => void>()
  const parser = physicalDeviceFrames(received, error)
  const first = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9])
  const second = Buffer.from([0xff, 0xd8, 0x02, 0xff, 0xd9])
  const bytes = Buffer.concat([packet(first), packet(second), Buffer.from('--dovo-frame--\r\n')])
  for (let i = 0; i < bytes.length; i += 3) parser.write(bytes.subarray(i, i + 3))
  parser.end()
  await tick()
  expect(received.mock.calls).toEqual([[first], [second]])
  expect(error).not.toHaveBeenCalled()
})

it.each([
  '',
  'Content-Length: -1\r\n',
  'Content-Length: 0\r\n',
  'Content-Length: 8388609\r\n',
  'Content-Length: 5\r\nContent-Length: 5\r\n',
  'Content-Length: five\r\n',
])('rejects missing, malformed or oversized frame lengths: %s', async (header) => {
  const received = vi.fn<(data: Buffer) => void>(),
    error = vi.fn<(error: Error) => void>()
  const parser = physicalDeviceFrames(received, error)
  parser.write(`--dovo-frame\r\n${header}\r\nabc\r\n`)
  await tick()
  expect(error).toHaveBeenCalledOnce()
  expect(error.mock.calls[0]?.[0]).toMatchObject({
    message: 'Invalid physical device frame length',
  })
  expect(received).not.toHaveBeenCalled()
  expect(parser.destroyed).toBe(true)
})

it.each([
  { size: 5, body: 'abc', message: 'Incomplete physical device frame' },
  { size: 2, body: 'abc', message: 'Physical device frame exceeds declared length' },
])('rejects invalid image bodies ($message)', async ({ size, body, message }) => {
  const received = vi.fn<(data: Buffer) => void>(),
    error = vi.fn<(error: Error) => void>()
  const parser = physicalDeviceFrames(received, error)
  parser.end(`--dovo-frame\r\nContent-Length: ${size}\r\n\r\n${body}\r\n--dovo-frame--\r\n`)
  await tick()
  expect(error).toHaveBeenCalledOnce()
  expect(error.mock.calls[0]?.[0]).toMatchObject({ message })
  expect(received).not.toHaveBeenCalled()
})
