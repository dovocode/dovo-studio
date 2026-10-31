import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
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

it('reuses an unchanged thumbnail after expiry but notices changed and higher priority assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-project-icon-source-'))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const image = (background: string) =>
    sharp({ create: { width: 32, height: 32, channels: 4, background } })
      .png()
      .toBuffer()
  const orange = await image('#ff8800')
  const blue = await image('#1188cc')
  const green = await image('#00cc00')
  const encode = vi.spyOn(sharp.prototype, 'toBuffer')
  try {
    await writeFile(join(root, 'logo.png'), orange)
    const first = await discoverProjectIcon(root)
    expect(encode).toHaveBeenCalledTimes(1)
    clock.mockReturnValue(31_001)
    expect(await discoverProjectIcon(root)).toBe(first)
    expect(encode).toHaveBeenCalledTimes(1)
    await writeFile(join(root, 'logo.png'), blue)
    clock.mockReturnValue(61_002)
    const changed = await discoverProjectIcon(root)
    expect(changed).not.toBe(first)
    expect(encode).toHaveBeenCalledTimes(2)
    await mkdir(join(root, 'app'))
    await writeFile(join(root, 'app', 'icon.png'), green)
    clock.mockReturnValue(91_003)
    expect(await discoverProjectIcon(root)).not.toBe(changed)
    expect(encode).toHaveBeenCalledTimes(3)
    await rm(join(root, 'app', 'icon.png'))
    clock.mockReturnValue(121_004)
    expect(await discoverProjectIcon(root)).toBe(changed)
  } finally {
    encode.mockRestore()
    clock.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

it('rechecks containment when a cached icon is replaced by an outside symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-project-icon-contained-'))
  const outside = await mkdtemp(join(tmpdir(), 'dovo-project-icon-outside-'))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    const image = await sharp({
      create: { width: 32, height: 32, channels: 4, background: '#ff8800' },
    })
      .png()
      .toBuffer()
    await writeFile(join(root, 'logo.png'), image)
    await writeFile(join(outside, 'logo.png'), image)
    expect(await discoverProjectIcon(root)).toMatch(/^data:image\/png;base64,/)
    await rm(join(root, 'logo.png'))
    await symlink(join(outside, 'logo.png'), join(root, 'logo.png'))
    clock.mockReturnValue(31_001)
    expect(await discoverProjectIcon(root)).toBeUndefined()
  } finally {
    clock.mockRestore()
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
