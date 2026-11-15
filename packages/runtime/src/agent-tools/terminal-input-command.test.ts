import { expect, it } from 'vite-plus/test'
import { terminalInputData } from './terminal-input-command.js'

it('submits terminal text with one appended CR, including Enter alone', () => {
  expect(terminalInputData({ data: 'q', submit: true })).toBe('q\r')
  expect(terminalInputData({ data: '', submit: true })).toBe('\r')
})

it('preserves raw input bytes and never interprets backslash text', () => {
  for (const data of ['', 'q\\r', 'line\n', '\u0003', 'already\r', 'λ🙂']) {
    expect(terminalInputData({ data })).toBe(data)
    expect(terminalInputData({ data, submit: false })).toBe(data)
    expect(terminalInputData({ data, submit: true })).toBe(data + '\r')
  }
})

it('rejects missing text and invalid submit flags', () => {
  for (const input of [
    {},
    { data: 42 },
    { data: 'q', submit: 'true' },
    { data: 'q', submit: null },
  ])
    expect(() => terminalInputData(input)).toThrow('Expected terminal')
})
