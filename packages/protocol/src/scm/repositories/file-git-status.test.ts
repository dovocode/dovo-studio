import { expect, it } from 'vite-plus/test'
import { decode, decodeResult } from '../../shared/schema.js'
import { fileSchema } from '../../workspace.js'

const file = { path: 'file.ts', before: 'old', after: 'new', viewed: false }

it('keeps older file payloads unknown and preserves optional staging metadata', () => {
  expect(decode(fileSchema, file)).toEqual(file)
  const current = { ...file, gitStatus: { index: 'modified', workingTree: 'modified' } }
  expect(decode(fileSchema, current)).toEqual(current)
  expect(
    decodeResult(fileSchema, { ...file, gitStatus: { index: 'invalid', workingTree: 'modified' } })
      .success,
  ).toBe(false)
})
