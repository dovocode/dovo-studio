import type { Attachment } from '@dovo/protocol'
export type NativeImageGalleryProps = {
  taskId: string
  files: Attachment[]
  initial: { attachment: Attachment; data: string }
  onClose: () => void
  onEdit?: (id: string) => void
}
