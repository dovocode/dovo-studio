import type { Attachment } from '@dovo/protocol'

export type LocalAttachment = {
  attachment: Attachment
  url?: string
  revision?: number
}

/** A successful upload can be used before polling catches up; an acknowledged removal wins. */
export function draftAttachments(
  saved: Attachment[],
  uploads: LocalAttachment[],
  revision?: number,
) {
  return [
    ...saved,
    ...uploads
      .filter(
        (item) =>
          item.revision !== undefined &&
          !saved.some((file) => file.id === item.attachment.id) &&
          (revision === undefined || revision < item.revision),
      )
      .map((item) => item.attachment),
  ]
}
