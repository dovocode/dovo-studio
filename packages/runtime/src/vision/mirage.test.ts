import { expect, it } from 'vite-plus/test'
import { analyzeMirage } from './mirage.js'
import { visionSchema } from './schema.js'

it('rejects invalid decision forms and unsupported image sources', () => {
  for (const input of [
    { action: 'decide', image: { path: 'test.png' } },
    {
      action: 'decide',
      image: { path: 'test.png' },
      form: { count: { type: 'integer', minimum: 4, maximum: 1 } },
    },
    { action: 'describe', image: { url: 'https://example.com/private.png' } },
    { action: 'describe', image: { data: 'image', mimeType: 'text/html' } },
  ])
    expect(visionSchema.safeParse(input).success).toBe(false)
})

it('cancels the inference worker and handles corrupt images', async () => {
  const input = visionSchema.parse({
    action: 'ocr',
    image: { data: 'aW1hZ2U=', mimeType: 'image/png' },
  })
  const controller = new AbortController()
  const pending = analyzeMirage(Buffer.from('invalid image'), input, controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow('cancelled')
  await expect(
    analyzeMirage(Buffer.from('invalid image'), input, new AbortController().signal),
  ).rejects.toThrow(/image|format/i)
}, 15000)
