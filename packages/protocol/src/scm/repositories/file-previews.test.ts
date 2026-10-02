import { expect, it } from 'vitest'
import { checkpointFiles, filePreviewLabel } from './file-previews'
import { decode } from '../../shared/schema'
import { fileSchema } from '../../workspace'

it('keeps older binary paths selectable without duplicating files or treating them as text', () => {
  const text = { path: 'code.ts', before: 'a', after: 'b', viewed: false }
  const files = checkpointFiles({ files: [text], omitted: ['icon.png', 'code.ts'] })
  expect(files).toHaveLength(2)
  expect(files[0]).toBe(text)
  expect(files[1]).toMatchObject({ path: 'icon.png', preview: { kind: 'deferred' } })
  expect(filePreviewLabel(files[1])).toBe('Preview loads when opened')
})
it('preserves saved metadata when changed files pass through the protocol', () => {
  const file = {
    path: 'icon.png',
    before: '',
    after: '',
    viewed: false,
    preview: { kind: 'image', after: { size: 123, hash: 'blob', mode: '100644' } },
  }
  expect(decode(fileSchema, file)).toEqual(file)
})
