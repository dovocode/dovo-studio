const prefix = 'data:image/png;base64,'
const maxClipboardBytes = 20 * 1024 * 1024

export function clipboardImageData(data: string) {
  if (!data.startsWith(prefix)) throw new Error('Clipboard image format is not supported.')
  if (data.length === prefix.length) throw new Error('No image found on the clipboard.')
  if (data.length - prefix.length > Math.ceil(maxClipboardBytes / 3) * 4)
    throw new Error('Clipboard image is too large to process. Choose a smaller image.')
  return data.slice(prefix.length)
}
