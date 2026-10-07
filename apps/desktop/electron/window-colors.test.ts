import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import {
  defaultWindowColors,
  parseWindowColors,
  readWindowColors,
  titleBarOverlay,
  writeWindowColors,
} from './window-colors'

it('accepts only six-digit hex colours and remembers the last reported palette', async () => {
  expect(parseWindowColors({ background: '#0D1117', symbol: '#8b949e' })).toEqual({
    background: '#0d1117',
    symbol: '#8b949e',
  })
  expect(parseWindowColors({ background: 'red', symbol: '#8b949e' })).toBeUndefined()
  expect(parseWindowColors({ background: '#0d1117' })).toBeUndefined()
  expect(parseWindowColors('#0d1117')).toBeUndefined()
  expect(defaultWindowColors(true).background).toBe('#080808')
  expect(defaultWindowColors(false).background).toBe('#ffffff')
  expect(titleBarOverlay({ background: '#ffffff', symbol: '#525252' })).toEqual({
    color: '#ffffff',
    symbolColor: '#525252',
    height: 44,
  })
  const directory = await mkdtemp(join(tmpdir(), 'dovo-window-colors-'))
  try {
    expect(readWindowColors(directory)).toBeUndefined()
    writeWindowColors(directory, { background: '#faf9f5', symbol: '#5f5e5a' })
    expect(readWindowColors(directory)).toEqual({ background: '#faf9f5', symbol: '#5f5e5a' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
