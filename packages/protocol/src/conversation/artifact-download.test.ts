import { expect, it } from 'vite-plus/test'
import { artifactDownloadMessageSchema, artifactDownloadName } from './artifact-download.js'
import { decodeResult } from '../shared/schema.js'

it('accepts empty and binary downloads and rejects malformed base64 messages', () => {
  const message = {
    type: 'artifact-download',
    nonce: 'preview',
    name: 'file.csv',
    mime: 'text/csv',
  }
  for (const data of ['', 'AAEC/w=='])
    expect(decodeResult(artifactDownloadMessageSchema, { ...message, data }).success).toBe(true)
  for (const data of ['a', 'a===', '%%%%', 'YWJj\n'])
    expect(decodeResult(artifactDownloadMessageSchema, { ...message, data }).success).toBe(false)
  expect(
    decodeResult(artifactDownloadMessageSchema, { ...message, type: 'open-url', data: '' }).success,
  ).toBe(false)
})

it('keeps download filenames local to the cache and strips invalid characters', () => {
  expect(artifactDownloadName('../../report.csv')).toBe('report.csv')
  expect(artifactDownloadName('C:\\temp\\report.csv')).toBe('report.csv')
  expect(artifactDownloadName('a\u0000b?.csv')).toBe('a_b_.csv')
  expect(artifactDownloadName('..')).toBe('download')
})
