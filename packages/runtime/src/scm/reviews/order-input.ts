import { decode, mutableArray, mutableStruct, type ReviewGroup } from '@dovo/protocol'
import { Schema } from 'effect'
import { posix } from 'node:path'

const moduleSchema = mutableStruct({
  path: Schema.String,
  before: Schema.optional(Schema.String),
  after: Schema.optional(Schema.String),
})
const sourceSchema = mutableStruct({
  ...moduleSchema.fields,
  previousPath: Schema.optional(Schema.String),
})
export const reviewAnalysisInput = mutableStruct({
  files: mutableArray(sourceSchema),
  modules: mutableArray(moduleSchema),
})
export type ReviewSource = typeof sourceSchema.Type
export type ReviewModule = typeof moduleSchema.Type

// Bound IPC input and parser work before serializing or spawning a process.
export const reviewAnalysisMaxBytes = 8 * 1024 * 1024
export function reviewAnalysisSize(files: ReviewSource[], modules: ReviewModule[]) {
  let bytes = 0
  for (const file of [...files, ...modules]) {
    bytes += Buffer.byteLength(file.path) + 64
    bytes += Buffer.byteLength(file.before ?? '') + Buffer.byteLength(file.after ?? '')
    if ('previousPath' in file && typeof file.previousPath === 'string')
      bytes += Buffer.byteLength(file.previousPath)
    if (bytes > reviewAnalysisMaxBytes) break
  }
  return bytes
}
export function readReviewAnalysis(value: unknown) {
  return decode(reviewAnalysisInput, value)
}

export function folderFileGroups(files: ReviewSource[]): ReviewGroup[] {
  const folders = new Map<string, string[]>()
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const folder = posix.dirname(file.path)
    const paths = folders.get(folder) ?? []
    paths.push(file.path)
    folders.set(folder, paths)
  }
  return [...folders].map(([folder, paths]) => ({
    label: folder === '.' ? 'Root files' : folder,
    paths,
    basis: 'folder',
  }))
}
