import type { Attachment } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { draftAttachments } from './draft-attachments'
const attachment: Attachment = { id: 'image', name: 'photo.png', mime: 'image/png', size: 100 }
it('makes completed uploads available while the snapshot is still behind', () => {
  expect(draftAttachments([], [{ attachment, revision: 4 }], 3)).toEqual([attachment])
  expect(draftAttachments([], [{ attachment, revision: 4 }])).toEqual([attachment])
})
it('does not send a file while it is uploading or duplicate it after acknowledgement', () => {
  expect(draftAttachments([], [{ attachment }], 3)).toEqual([])
  expect(draftAttachments([attachment], [{ attachment, revision: 4 }], 4)).toEqual([attachment])
})
it('does not restore attachments after a newer snapshot removes or sends them', () => {
  expect(draftAttachments([], [{ attachment, revision: 4 }], 5)).toEqual([])
})
