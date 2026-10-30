import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeIco } from 'icojs'
import sharp from 'sharp'
import { expect, it, vi } from 'vite-plus/test'
import { discoverProjectIcon } from './project-icon'

it('discovers a common SVG favicon without scanning unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-project-svg-icon-'))
  try {
    await mkdir(join(root, 'public'))
    await writeFile(
      join(root, 'public', 'favicon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>',
    )
    expect(await discoverProjectIcon(root)).toMatch(/^data:image\/png;base64,/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('discovers a local app icon and returns a bounded PNG thumbnail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-project-icon-'))
  try {
    await mkdir(join(root, 'app'))
    const image = await sharp({
      create: { width: 256, height: 256, channels: 4, background: '#ff8800' },
    })
      .png()
      .toBuffer()
    await writeFile(join(root, 'app', 'icon.png'), image)
    const icon = await discoverProjectIcon(root)
    expect(icon).toMatch(/^data:image\/png;base64,/)
    expect(icon!.length).toBeLessThan(50000)
    expect(await sharp(Buffer.from(icon!.split(',')[1], 'base64')).metadata()).toMatchObject({
      width: 48,
      height: 48,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('discovers a favicon.ico when the project has no PNG icon', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-project-favicon-'))
  try {
    await mkdir(join(root, 'public'))
    const image = await sharp({
      create: { width: 32, height: 32, channels: 4, background: '#1188cc' },
    })
      .png()
      .toBuffer()
    await writeFile(
      join(root, 'public', 'favicon.ico'),
      Buffer.from(await encodeIco([{ buffer: image }])),
    )
    expect(await discoverProjectIcon(root)).toMatch(/^data:image\/png;base64,/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('bounds retained project icons and refreshes expired thumbnails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-project-icon-cache-'))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const image = (background: string) =>
    sharp({
      create: { width: 32, height: 32, channels: 4, background },
    })
      .png()
      .toBuffer()
  try {
    await writeFile(join(root, 'logo.png'), await image('#ff8800'))
    const first = await discoverProjectIcon(root)
    await writeFile(join(root, 'logo.png'), await image('#1188cc'))
    expect(await discoverProjectIcon(root)).toBe(first)
    for (let index = 0; index < 256; index++)
      await discoverProjectIcon(join(root, `missing-${index}`))
    const replaced = await discoverProjectIcon(root)
    expect(replaced).not.toBe(first)
    await writeFile(join(root, 'logo.png'), await image('#ff8800'))
    clock.mockReturnValue(31001)
    expect(await discoverProjectIcon(root)).toBe(first)
  } finally {
    clock.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})
