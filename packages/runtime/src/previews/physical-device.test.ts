import { expect, it } from 'vitest'
import { physicalPoint, physicalKeys } from './physical-device'

it('maps portrait and landscape preview pixels into native touchscreen coordinates', () => {
  expect(physicalPoint(200, 400, 400, 800)).toEqual({ x: 32768, y: 32768 })
  expect(physicalPoint(800, 0, 800, 400)).toEqual({ x: 65535, y: 0 })
  expect(physicalPoint(-10, 900, 400, 800)).toEqual({ x: 0, y: 65535 })
})
it('rejects input before a frame or with invalid coordinates', () => {
  for (const values of [
    [1, 1, 0, 0],
    [NaN, 0, 400, 800],
    [0, 0, Infinity, 800],
  ])
    expect(() => physicalPoint(values[0], values[1], values[2], values[3])).toThrow(
      'Wait for the physical device screen before sending input',
    )
})
it('preserves case and modifiers without pressing duplicate keys', () => {
  expect(physicalKeys('A')).toEqual([225, 4])
  expect(physicalKeys('Meta+a')).toEqual([227, 4])
  expect(physicalKeys('Shift+A')).toEqual([225, 4])
  expect(physicalKeys('Enter')).toEqual([40])
  expect(() => physicalKeys('Unknown+a')).toThrow('This physical device key is not supported')
  expect(() => physicalKeys('Unrecognized')).toThrow('This physical device key is not supported')
})

it('parses MJPEG frames without requiring form-data disposition headers', async () => {
  const { Dicer } = await import('@fastify/busboy')
  const parser = new Dicer({ boundary: 'dovo-frame' })
  const frames: string[] = []
  const parts: Promise<void>[] = []
  const finished = new Promise<void>((resolve, reject) => {
    parser.on('error', reject)
    parser.on('finish', resolve)
    parser.on('part', (part) => {
      const chunks: Buffer[] = []
      part.on('error', reject)
      part.on('data', (chunk: Buffer) => chunks.push(chunk))
      parts.push(
        new Promise<void>((resolve) =>
          part.on('end', () => {
            frames.push(Buffer.concat(chunks).toString())
            resolve()
          }),
        ),
      )
    })
  })
  const stream =
    '--dovo-frame\r\nContent-Type: image/jpeg\r\n\r\nfirst\r\n--dovo-frame\r\nContent-Type: image/jpeg\r\n\r\nsecond\r\n--dovo-frame--\r\n'
  for (let index = 0; index < stream.length; index += 7)
    parser.write(stream.slice(index, index + 7))
  parser.end()
  await finished
  await Promise.all(parts)
  expect(frames).toEqual(['first', 'second'])
})
