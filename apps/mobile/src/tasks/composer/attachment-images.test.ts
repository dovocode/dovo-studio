import { expect, it } from 'vite-plus/test'
import { isHeicAttachment, jpegAttachmentName } from './attachment-images'

it('detects HEIC from photos and files even when the picker changes the URI extension', () => {
  expect(isHeicAttachment({ uri: 'file:///cache/image.jpg', name: 'IMG_2253.HEIC' })).toBe(true)
  expect(
    isHeicAttachment({ uri: 'file:///cache/photo', name: 'photo', mimeType: 'image/heif' }),
  ).toBe(true)
  expect(isHeicAttachment({ uri: 'file:///cache/photo.heic', name: 'photo' })).toBe(true)
  expect(
    isHeicAttachment({ uri: 'file:///cache/photo.png', name: 'photo.png', mimeType: 'image/png' }),
  ).toBe(false)
})
it('gives converted images a JPEG filename', () => {
  expect(jpegAttachmentName('IMG_2253.HEIC')).toBe('IMG_2253.jpg')
  expect(jpegAttachmentName('photo')).toBe('photo.jpg')
})
