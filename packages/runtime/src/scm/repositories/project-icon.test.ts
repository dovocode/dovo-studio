import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeIco } from 'icojs'
import sharp from 'sharp'
import { expect, it } from 'vite-plus/test'
import { discoverProjectIcon } from './project-icon'

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
