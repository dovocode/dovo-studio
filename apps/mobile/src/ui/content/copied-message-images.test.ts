import { expect, it } from 'vite-plus/test'
import { copiedMessageImages, rememberCopiedMessageImages } from './copied-message-images'

it('recovers images only for the current Studio clipboard marker', () => {
  const images = { runtimeId: 'computer', taskId: 'source-thread', ids: ['image'] }
  rememberCopiedMessageImages({ marker: 'first-copy', images })
  expect(copiedMessageImages('external-copy')).toBeUndefined()
  expect(copiedMessageImages('first-copy')).toEqual(images)

  rememberCopiedMessageImages({ marker: 'second-copy', images })
  expect(copiedMessageImages('first-copy')).toBeUndefined()
  expect(copiedMessageImages('second-copy')).toEqual(images)
  rememberCopiedMessageImages()
  expect(copiedMessageImages('second-copy')).toBeUndefined()
})
