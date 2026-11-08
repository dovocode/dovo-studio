import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import { generateTitleSchema } from './title-generation.js'

it('requires text or valid attachment metadata', () => {
  const attachment = {
    id: '8cf51548-a817-44fd-802f-1d22cb814101',
    name: 'shot.png',
    mime: 'image/png',
    size: 1,
  }
  expect(decode(generateTitleSchema, { text: ' ', attachments: [attachment] })).toMatchObject({
    text: '',
    attachments: [attachment],
  })
  expect(decode(generateTitleSchema, { text: ' title ' }).text).toBe('title')
  expect(() => decode(generateTitleSchema, { text: '' })).toThrow(/Provide text or attachments/)
  expect(() => decode(generateTitleSchema, { text: '', attachments: [] })).toThrow(
    /Provide text or attachments/,
  )
  expect(() =>
    decode(generateTitleSchema, { text: '', attachments: [{ ...attachment, id: 'invalid' }] }),
  ).toThrow(/id/)
})
