import { expect, it } from 'vite-plus/test'
import { chatImageData, chatImageName } from './chat-image'

it('keeps raster image data and gives JPEG copies the correct extension', () => {
  expect(chatImageData('data:image/jpeg;base64,aGVsbG8=')).toEqual({
    data: 'aGVsbG8=',
    mime: 'image/jpeg',
    extension: 'jpg',
  })
  expect(chatImageData('data:image/gif;base64,aGVsbG8=')).toMatchObject({ mime: 'image/gif' })
})

it('rejects non-images, active formats, remote URLs and empty image data', () => {
  for (const uri of [
    'data:text/html;base64,aGVsbG8=',
    'data:image/svg+xml;base64,aGVsbG8=',
    'https://example.com/image.png',
    'data:image/png;base64,',
    'data:image/png;base64,%%%',
  ])
    expect(() => chatImageData(uri)).toThrow('could not be read')
})

it('turns paths and chat labels into bounded filenames without path components', () => {
  expect(chatImageName('/runtime/output/chart.webp', 'png')).toBe('chart.png')
  expect(chatImageName('C:\\images\\photo.jpg', 'jpg')).toBe('photo.jpg')
  expect(chatImageName('Screenshot: project?', 'png')).toBe('Screenshot project.png')
  expect(chatImageName('', 'png')).toBe('chat-image.png')
  expect(chatImageName('a'.repeat(1000), 'png').length).toBe(184)
})
