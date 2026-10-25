import { expect, it } from 'vite-plus/test'
import sharp from 'sharp'
import { BrowserFrameEncoder } from './browser-frame-encoder'

it('learns serialization, preserves fast links and recovers after a route change', () => {
  const encoder = new BrowserFrameEncoder()
  encoder.observe({ sentAt: 0, bytes: 24000 }, 100, 1)
  encoder.observe({ sentAt: 32, bytes: 24000 }, 132, 1)
  expect(encoder.budget(132)).toBe(Infinity)
  encoder.observe({ sentAt: 33, bytes: 24000 }, 228, 1)
  expect(encoder.budget(228)).toBe(8000)
  expect(encoder.budget(4228)).toBe(10000)
  expect(encoder.budget(4229)).toBe(10000)
  expect(encoder.budget(5228)).toBe(12500)
  // A different viewer has an independent budget, even on the same browser.
  expect(new BrowserFrameEncoder().budget(5228)).toBe(Infinity)
})

it('does not mistake a slow decoder or out-of-order ACK for a narrow network', () => {
  const encoder = new BrowserFrameEncoder()
  encoder.observe({ sentAt: 0, bytes: 24000 }, 100, 80)
  encoder.observe({ sentAt: 16, bytes: 24000 }, 200, 80)
  encoder.observe({ sentAt: 0, bytes: 24000 }, 300, 1)
  expect(encoder.budget(300)).toBe(Infinity)
})

it('reduces real JPEG payloads while retaining CSS coordinates and more idle detail', async () => {
  const pixels = Buffer.alloc(1280 * 800 * 3)
  for (let y = 0; y < 800; y++)
    for (let x = 0; x < 1280; x++) {
      const offset = (y * 1280 + x) * 3
      pixels[offset] = (x * 7 + y * 3) % 256
      pixels[offset + 1] = (x + y * 5) % 256
      pixels[offset + 2] = (x * 3 + y) % 256
    }
  const data = await sharp(pixels, { raw: { width: 1280, height: 800, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer()
  const frame = { type: 'frame' as const, width: 640, height: 400, data }
  const encoder = new BrowserFrameEncoder()
  expect(await encoder.encode(frame, Infinity)).toBe(frame)
  const motion = await encoder.encode(frame, 8000)
  const detail = await encoder.encode({ ...frame, detail: true }, 8000)
  expect(motion.width).toBe(640)
  expect(motion.height).toBe(400)
  expect(motion.data.byteLength).toBeLessThan(data.byteLength / 3)
  expect(detail.data.byteLength).toBeGreaterThan(motion.data.byteLength)
  const image = await sharp(motion.data).metadata()
  expect(image.format).toBe('jpeg')
  expect(image.width).toBeGreaterThanOrEqual(320)
  expect(image.width).toBeLessThanOrEqual(640)
})
