import { readFile, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { decodeIco } from 'icojs'
import sharp from 'sharp'

const candidates = [
  'app/icon.png',
  'app/favicon.ico',
  'src/app/icon.png',
  'src/app/favicon.ico',
  'public/favicon.ico',
  'public/favicon.png',
  'public/logo.png',
  'assets/icon.png',
  'assets/images/icon.png',
  'assets/logo.png',
  'favicon.ico',
  'logo.png',
  'logo.svg',
]
const cache = new Map<string, { icon?: string; expires: number }>()

/** Read only common app assets inside the checkout, then send a bounded thumbnail to clients. */
export async function discoverProjectIcon(path: string): Promise<string | undefined> {
  const cached = cache.get(path)
  if (cached && cached.expires > Date.now()) return cached.icon
  let icon: string | undefined
  try {
    const root = await realpath(path)
    for (const candidate of candidates) {
      try {
        const file = await realpath(join(root, candidate))
        if (!file.startsWith(root + sep)) continue
        if ((await stat(file)).size > 2 * 1024 * 1024) continue
        const source = file.endsWith('.ico')
          ? Buffer.from(
              (await decodeIco(await readFile(file), 'image/png')).sort(
                (a, b) => b.width * b.height - a.width * a.height,
              )[0]?.buffer ?? new ArrayBuffer(0),
            )
          : file
        const png = await sharp(source, { limitInputPixels: 4 * 1024 * 1024 })
          .resize(48, 48, { fit: 'contain', background: '#00000000' })
          .png({ palette: true })
          .toBuffer()
        const value = `data:image/png;base64,${png.toString('base64')}`
        if (value.length <= 50000) {
          icon = value
          break
        }
      } catch {
        // Some projects contain unsupported icon formats; keep looking.
      }
    }
  } catch {
    // A temporarily unavailable checkout still appears without an icon.
  }
  cache.set(path, { icon, expires: Date.now() + 30000 })
  return icon
}
