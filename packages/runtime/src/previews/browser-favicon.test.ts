import { expect, it, vi } from 'vite-plus/test'
import sharp from 'sharp'
import { createBrowserFaviconLoader, type FaviconFetch } from './browser-favicon.js'

const png = () =>
  sharp({ create: { width: 64, height: 64, channels: 4, background: '#e05020' } })
    .png()
    .toBuffer()

it('tries broken candidates and root fallback, decoding real bytes despite missing or incorrect MIME', async () => {
  const fetchIcon = vi
    .fn<FaviconFetch>()
    .mockResolvedValueOnce(new Response('broken', { headers: { 'content-type': 'image/png' } }))
    .mockResolvedValueOnce(
      new Response(await png(), { headers: { 'content-type': 'application/octet-stream' } }),
    )
  const publish = vi.fn<(icon: string | null) => void>()
  await createBrowserFaviconLoader(fetchIcon, publish).load('http://localhost:3000/page', [
    '/missing.png',
  ])
  expect(fetchIcon.mock.calls.map(([url]) => url)).toEqual([
    'http://localhost:3000/missing.png',
    'http://localhost:3000/favicon.ico',
  ])
  const icon = publish.mock.calls[0]![0]!
  expect(icon).toMatch(/^data:image\/png;base64,/)
  expect(await sharp(Buffer.from(icon.split(',')[1]!, 'base64')).metadata()).toMatchObject({
    width: 64,
    height: 64,
    format: 'png',
  })
})

it('keeps high-resolution detail within the viewer limit and selects the largest ICO image', async () => {
  const large = await sharp({
    create: { width: 256, height: 256, channels: 4, background: '#2070e0' },
  })
    .png()
    .toBuffer()
  const small = await png()
  const ico = Buffer.alloc(38 + small.length + large.length)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(2, 4)
  for (const [index, bytes, dimension, offset] of [
    [0, small, 64, 38],
    [1, large, 0, 38 + small.length],
  ] as const) {
    const entry = 6 + index * 16
    ico[entry] = dimension
    ico[entry + 1] = dimension
    ico.writeUInt16LE(1, entry + 4)
    ico.writeUInt16LE(32, entry + 6)
    ico.writeUInt32LE(bytes.length, entry + 8)
    ico.writeUInt32LE(offset, entry + 12)
    bytes.copy(ico, offset)
  }
  const publish = vi.fn<(icon: string | null) => void>()
  const fetchIcon = vi.fn<FaviconFetch>().mockResolvedValueOnce(new Response(ico))
  await createBrowserFaviconLoader(fetchIcon, publish).load('https://example.com', ['/icon.ico'])
  const icon = publish.mock.calls[0]![0]!
  expect(icon.length).toBeLessThan(100_000)
  const image = sharp(Buffer.from(icon.split(',')[1]!, 'base64'))
  expect(await image.metadata()).toMatchObject({ width: 128, height: 128 })
  expect((await image.raw().toBuffer()).subarray(0, 4)).toEqual(Buffer.from([32, 112, 224, 255]))
})

it('loads inline SVG and ICO and rasterizes them before passing them to viewers', async () => {
  const fetchIcon = vi.fn<FaviconFetch>()
  const publish = vi.fn<(icon: string | null) => void>()
  const loader = createBrowserFaviconLoader(fetchIcon, publish)
  await loader.load('https://example.com/', [
    'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>',
      ),
  ])
  expect(fetchIcon).not.toHaveBeenCalled()
  expect(publish).toHaveBeenLastCalledWith(expect.stringMatching(/^data:image\/png;base64,/))
  const vector = publish.mock.calls[0]![0]!
  expect(await sharp(Buffer.from(vector.split(',')[1]!, 'base64')).metadata()).toMatchObject({
    width: 128,
    height: 128,
  })
  const image = await png()
  const ico = Buffer.alloc(22 + image.length)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico[6] = 64
  ico[7] = 64
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(image.length, 14)
  ico.writeUInt32LE(22, 18)
  image.copy(ico, 22)
  fetchIcon.mockResolvedValueOnce(new Response(ico))
  await loader.load('https://example.com/ico', ['/icon.ico'])
  expect(publish).toHaveBeenCalledTimes(2)
  expect(publish).toHaveBeenLastCalledWith(expect.stringMatching(/^data:image\/png;base64,/))
})

it('rejects unsafe URLs and excessive bodies and falls back to a valid image', async () => {
  const fetchIcon = vi
    .fn<FaviconFetch>()
    .mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024 + 1)))
    .mockResolvedValueOnce(new Response(await png()))
  const publish = vi.fn<(icon: string | null) => void>()
  await createBrowserFaviconLoader(fetchIcon, publish).load('https://example.com/', [
    'file:///secret.png',
    'https://user:secret@other.test/icon',
    'javascript:alert(1)',
    '/huge.png',
    '/valid.png',
  ])
  expect(fetchIcon.mock.calls.map(([url]) => url)).toEqual([
    'https://example.com/huge.png',
    'https://example.com/valid.png',
  ])
  expect(publish).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/))
})

it('does not publish an old request after a newer update or a same-URL reload', async () => {
  let finish!: (response: Response) => void
  const fetchIcon = vi
    .fn<FaviconFetch>()
    .mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
    )
    .mockResolvedValue(new Response(await png()))
  const publish = vi.fn<(icon: string | null) => void>()
  const loader = createBrowserFaviconLoader(fetchIcon, publish)
  const old = loader.load('https://example.com/', ['/old.png'])
  await loader.load('https://example.com/', ['/new.png'])
  finish(new Response(await png()))
  await old
  expect(fetchIcon.mock.calls[0]![1].aborted).toBe(true)
  expect(publish).toHaveBeenCalledTimes(1)
  loader.reset()
  fetchIcon.mockResolvedValue(new Response('not an image'))
  await loader.load('https://example.com/', ['/new.png'])
  expect(publish).toHaveBeenLastCalledWith(null)
})
