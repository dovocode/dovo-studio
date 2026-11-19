import { previewUrl, screenshotData } from '@dovo/protocol'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'

const prefix = 'Dovo browser snapshot\n'
const maxImage = 20_000_000

const pngBytes = (data: string) => Uint8Array.from(atob(data), (byte) => byte.charCodeAt(0))

export async function copyBrowserSnapshot(
  capture: () => Promise<string>,
  source: { url: string; title: string },
) {
  const context = { url: previewUrl(source.url), title: source.title.slice(0, 1000) }
  const image = capture().then(screenshotData)
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const png = image.then((data) => new Blob([pngBytes(data)], { type: 'image/png' }))
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': png,
          'text/plain': new Blob([prefix + JSON.stringify(context)], { type: 'text/plain' }),
        }),
      ])
      return
    } catch {
      await png
    }
  }
  const data = await image
  if (data.length > maxImage) throw new Error('The snapshot is too large to copy.')
  // LAN HTTP does not expose the binary Clipboard API. Studio can still paste the image.
  await copyTextToClipboard(prefix + JSON.stringify({ ...context, data }))
}

export function browserSnapshotPaste(files: File[], clipboardText: string): File[] | undefined {
  if (
    files.length > 1 ||
    (files.length && files[0].type !== 'image/png') ||
    !clipboardText.startsWith(prefix) ||
    clipboardText.length > maxImage + 12_000
  )
    return undefined
  try {
    const source: unknown = JSON.parse(clipboardText.slice(prefix.length))
    if (
      !source ||
      typeof source !== 'object' ||
      !('url' in source) ||
      typeof source.url !== 'string' ||
      !/^https?:\/\//i.test(source.url) ||
      !('title' in source) ||
      typeof source.title !== 'string'
    )
      return undefined
    const url = previewUrl(source.url)
    const title = source.title.replace(/\s+/g, ' ').trim().slice(0, 1000)
    const fromClipboard = files[0]
    const encoded = 'data' in source && typeof source.data === 'string' ? source.data : undefined
    if (!fromClipboard && (!encoded || encoded.length > maxImage)) return undefined
    const image = fromClipboard ?? pngBytes(encoded ?? '')
    const name = `browser-snapshot-${Date.now()}`
    return [
      new File([image], `${name}.png`, { type: 'image/png' }),
      new File([`Page: ${title || url}\nURL: ${url}\nImage: ${name}.png\n`], `${name}-source.txt`, {
        type: 'text/plain',
      }),
    ]
  } catch {
    return undefined
  }
}
