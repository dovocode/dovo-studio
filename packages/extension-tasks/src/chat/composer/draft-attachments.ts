import type { Attachment } from '@dovo/protocol'

export type LocalAttachment = {
  attachment: Attachment
  url?: string
  revision?: number
  replaces?: string
}

/** A successful upload can be used before polling catches up; an acknowledged removal wins. */
export function draftAttachments(
  saved: Attachment[],
  uploads: LocalAttachment[],
  revision?: number,
) {
  const ready = uploads.filter(
    (item) => item.revision !== undefined && (revision === undefined || revision < item.revision),
  )
  return [
    ...saved.map((file) => ready.find((item) => item.replaces === file.id)?.attachment ?? file),
    ...ready
      .filter(
        (item) =>
          !saved.some((file) => file.id === item.attachment.id || file.id === item.replaces),
      )
      .map((item) => item.attachment),
  ]
}
