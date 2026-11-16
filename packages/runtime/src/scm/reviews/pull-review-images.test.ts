import { expect, it } from 'vite-plus/test'
import { pullReviewImages } from './pull-review-images'
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
it('detects image type from bytes and captures a digest without trusting file names', async () => {
  const [image] = await pullReviewImages([{ name: '../../pretend.jpg', data: png }])
  expect(image).toMatchObject({ id: 'image-1', name: '../../pretend.jpg', mime: 'image/png' })
  expect(image.digest).toMatch(/^[a-f0-9]{64}$/)
})
it('rejects malformed encoding, non-images and oversized input', async () => {
  for (const data of [
    'bad!',
    Buffer.from('not an image').toString('base64'),
    Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
  ])
    await expect(pullReviewImages([{ name: 'image.png', data }])).rejects.toThrow(/image/i)
})
