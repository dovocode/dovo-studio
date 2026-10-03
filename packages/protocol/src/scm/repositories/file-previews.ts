import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'
import type { ChangedFile, TaskTurn } from '../../workspace.js'

const savedFileSchema = mutableStruct({
  hash: Schema.String,
  size: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  mode: Schema.String,
})
export const filePreviewMetadataSchema = mutableStruct({
  kind: Schema.Literal('image', 'binary', 'large', 'deferred', 'symlink', 'submodule'),
  before: Schema.optional(savedFileSchema),
  after: Schema.optional(savedFileSchema),
})
const previewSideSchema = mutableStruct({
  kind: Schema.Literal('text', 'image', 'binary', 'submodule'),
  size: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  text: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  truncated: Schema.Boolean,
  notice: Schema.optional(Schema.String),
})
export const filePreviewSchema = mutableStruct({
  before: Schema.optional(previewSideSchema),
  after: Schema.optional(previewSideSchema),
})
export type FilePreview = Schema.Schema.Type<typeof filePreviewSchema>
export type FilePreviewMetadata = Schema.Schema.Type<typeof filePreviewMetadataSchema>

/** Older checkpoints listed preview-limited paths separately. Keep them selectable too. */
export function checkpointFiles(
  checkpoint: Pick<NonNullable<TaskTurn['checkpoint']>, 'files' | 'omitted'>,
): ChangedFile[] {
  const paths = new Set(checkpoint.files.map((file) => file.path))
  return [
    ...checkpoint.files,
    ...checkpoint.omitted
      .filter((path) => !paths.has(path))
      .map((path): ChangedFile => ({
        path,
        before: '',
        after: '',
        viewed: false,
        preview: { kind: 'deferred' },
      })),
  ]
}
export function filePreviewLabel(file: ChangedFile | undefined) {
  switch (file?.preview?.kind) {
    case 'image':
      return 'Image preview'
    case 'binary':
      return 'Binary file'
    case 'large':
      return 'Large file · compact preview'
    case 'deferred':
      return 'Preview loads when opened'
    case 'symlink':
      return 'Symbolic link'
    case 'submodule':
      return 'Submodule'
    default:
      return ''
  }
}
export function fileSizeLabel(size: number) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Counts all repositories without flattening or copying their file bodies. */
export function checkpointFileCount(checkpoint: TaskTurn['checkpoint']) {
  if (!checkpoint) return 0
  return (
    checkpoint.files.length +
    checkpoint.omitted.length +
    (checkpoint.linked?.reduce((sum, item) => sum + item.files.length + item.omitted.length, 0) ??
      0)
  )
}

export function checkpointCanUndo(checkpoint: TaskTurn['checkpoint']) {
  if (!checkpoint || checkpoint.error) return false
  return [checkpoint, ...(checkpoint.linked ?? [])].some(
    (item) =>
      !!item.after && !item.error && !item.undone && item.files.length + item.omitted.length > 0,
  )
}
