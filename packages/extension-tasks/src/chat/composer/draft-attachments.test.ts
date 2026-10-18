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
it('replaces a draft only after its edited upload succeeds, before snapshot confirmation', () => {
  const edited = { ...attachment, id: 'edited', name: 'edited.png' }
  expect(
    draftAttachments([attachment], [{ attachment: edited, replaces: attachment.id }], 3),
  ).toEqual([attachment])
  expect(
    draftAttachments(
      [attachment],
      [{ attachment: edited, replaces: attachment.id, revision: 4 }],
      3,
    ),
  ).toEqual([edited])
  expect(
    draftAttachments([edited], [{ attachment: edited, replaces: attachment.id, revision: 4 }], 4),
  ).toEqual([edited])
  expect(
    draftAttachments([], [{ attachment: edited, replaces: attachment.id, revision: 4 }], 5),
  ).toEqual([])
})
