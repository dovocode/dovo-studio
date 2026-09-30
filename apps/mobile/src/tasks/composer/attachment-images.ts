export function isHeicAttachment(asset: { uri: string; name: string; mimeType?: string | null }) {
  return (
    /\.(heic|heif)(?:$|[?#])/i.test(asset.name) ||
    /\.(heic|heif)(?:$|[?#])/i.test(asset.uri) ||
    /^image\/hei[cf](?:-sequence)?$/i.test(asset.mimeType ?? '')
  )
}
export function jpegAttachmentName(name: string) {
  return `${name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`
}
