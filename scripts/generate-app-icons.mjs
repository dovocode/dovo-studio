import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
if (process.platform !== 'darwin') throw new Error('Icon export uses macOS sips and iconutil.')
const resize = (source, size, output) =>
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', output], {
    stdio: 'ignore',
  })
const ios = join(root, 'assets/brand/dovo-icon-source.png')
const mac = join(root, 'assets/brand/dovo-mac-icon-source.png')
await mkdir(join(root, 'apps/desktop/build'), { recursive: true })
resize(ios, 1024, join(root, 'apps/mobile/assets/icon.png'))
resize(mac, 1024, join(root, 'apps/desktop/build/icon.png'))
const temporary = await mkdtemp(join(tmpdir(), 'dovo-icons-'))
try {
  const iconset = join(temporary, 'icon.iconset')
  await mkdir(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    resize(mac, size, join(iconset, `icon_${size}x${size}.png`))
    resize(mac, size * 2, join(iconset, `icon_${size}x${size}@2x.png`))
  }
  execFileSync('iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    join(root, 'apps/desktop/build/icon.icns'),
  ])
} finally {
  await rm(temporary, { recursive: true, force: true })
}
