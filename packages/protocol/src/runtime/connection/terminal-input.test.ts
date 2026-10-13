import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { responses, terminalInputSchema } from './runtime.js'

it('retains negotiated terminal byte support while accepting older tickets', () => {
  expect(decode(responses.ticket, { ticket: 'legacy' })).toEqual({ ticket: 'legacy' })
  expect(decode(responses.ticket, { ticket: 'current', byteInput: true })).toEqual({
    ticket: 'current',
    byteInput: true,
  })
})

it('accepts canonical terminal bytes with an exact 64 KiB decoded bound', () => {
  for (const bytes of [Buffer.from([0, 128, 255]), Buffer.alloc(65536, 255)]) {
    const frame = { type: 'input-bytes', data: bytes.toString('base64') }
    expect(decode(terminalInputSchema, frame)).toEqual(frame)
  }
  for (const data of [
    '',
    'gA',
    'gA==\n',
    'gB==', // nonzero padding bits
    'AAD=',
    '%%%%',
    Buffer.alloc(65537).toString('base64'),
  ]) {
    expect(() => decode(terminalInputSchema, { type: 'input-bytes', data })).toThrow()
  }
})
