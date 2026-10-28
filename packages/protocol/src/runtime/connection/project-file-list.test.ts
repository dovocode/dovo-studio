import { expect, it } from 'vite-plus/test'
import { Schema } from 'effect'
import { responses } from './runtime'

it('preserves listing completeness and accepts older responses without it', () => {
  const decode = Schema.decodeUnknownSync(responses.projectFileList)
  expect(decode({ files: ['a'], truncated: true })).toEqual({ files: ['a'], truncated: true })
  expect(decode({ files: ['a'], truncated: false })).toEqual({ files: ['a'], truncated: false })
  expect(decode({ files: ['a'] })).toEqual({ files: ['a'] })
})
