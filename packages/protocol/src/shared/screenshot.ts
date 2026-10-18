import { ATTACHMENT_IMAGE_MAX_SOURCE_BYTES } from './attachment-images.js'

/** Only accept bounded, inline PNG screenshots from a preview surface. */
export function screenshotData(image: unknown): string {
  if (
    typeof image !== 'string' ||
    image.length > Math.ceil(ATTACHMENT_IMAGE_MAX_SOURCE_BYTES / 3) * 4 + 22 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
  )
    throw new Error('Could not read the screenshot. Capture it again.')
  return image.slice('data:image/png;base64,'.length)
}
