import { readFile, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { decodeIco } from 'icojs'
import sharp from 'sharp'

const candidates = [
  'app/icon.png',
  'app/icon.svg',
  'app/favicon.ico',
  'src/app/icon.png',
  'src/app/icon.svg',
  'src/app/favicon.ico',
  'public/favicon.ico',
  'public/favicon.png',
  'public/favicon.svg',
  'public/icon.svg',
  'public/logo.svg',
  'static/favicon.png',
  'static/favicon.svg',
  'static/favicon.ico',
  'public/logo.png',
  'assets/icon.png',
  'assets/images/icon.png',
  'assets/logo.png',
  'favicon.ico',
  'logo.png',
  'logo.svg',
]
const cache = new Map<string, { icon?: string; source?: string; expires: number }>()

/** Read only common app assets inside the checkout, then send a bounded thumbnail to clients. */
export async function discoverProjectIcon(path: string): Promise<string | undefined> {
  const now = Date.now()
  // Keep source identity across refreshes, but release icons from inactive projects.
  for (const [key, entry] of cache) if (entry.expires + 300_000 <= now) cache.delete(key)
  const cached = cache.get(path)
  if (cached && cached.expires > now) {
    cache.delete(path)
    cache.set(path, cached)
    return cached.icon
  }
  let icon: string | undefined
  let sourceIdentity: string | undefined
  try {
    const root = await realpath(path)
    for (const candidate of candidates) {
      try {
        const file = await realpath(join(root, candidate))
        if (!file.startsWith(root + sep)) continue
        const info = await stat(file, { bigint: true })
        if (!info.isFile() || info.size > 2n * 1024n * 1024n) continue
        const identity = [file, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
        if (cached?.icon && cached.source === identity) {
          icon = cached.icon
          sourceIdentity = identity
          break
        }
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
          sourceIdentity = identity
          break
        }
      } catch {
        // Some projects contain unsupported icon formats; keep looking.
      }
    }
  } catch {
    // A temporarily unavailable checkout still appears without an icon.
  }
  if (cache.size >= 256 && !cache.has(path)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.delete(path)
  cache.set(path, { icon, source: sourceIdentity, expires: Date.now() + 30000 })
  return icon
}
