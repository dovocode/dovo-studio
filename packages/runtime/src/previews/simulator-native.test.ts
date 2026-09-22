import { expect, it } from 'vitest'
import { MinicapFrames } from './simulator-native'
it('assembles fragmented native video packets and multiple frames without JPEG parsing', () => {
  const header = Buffer.alloc(24)
  header[0] = 1
  header[1] = 24
  const image = Buffer.from([255, 216, 10, 20, 255, 217])
  const size = Buffer.alloc(4)
  size.writeUInt32LE(image.length)
  const stream = Buffer.concat([header, size, image, size, image])
  const parser = new MinicapFrames(),
    frames: Buffer[] = []
  for (let index = 0; index < stream.length; index += 3)
    parser.push(stream.subarray(index, index + 3), (frame) => frames.push(frame))
  expect(frames).toEqual([image, image])
})
it('rejects unbounded or incompatible native video packets', () => {
  expect(() => new MinicapFrames().push(Buffer.from([2, 24]), () => {})).toThrow('header')
  const header = Buffer.alloc(28)
  header[0] = 1
  header[1] = 24
  header.writeUInt32LE(0xffffffff, 24)
  expect(() => new MinicapFrames().push(header, () => {})).toThrow('length')
})
