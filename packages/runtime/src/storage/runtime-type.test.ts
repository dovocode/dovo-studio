import { expect, it } from 'vite-plus/test'
import { detectRuntimeType } from './runtime-type'

it('recognizes server deployments independently of hardware or display sessions', () => {
  expect(detectRuntimeType('archive', 'linux', () => '9')).toBe('server')
  expect(detectRuntimeType('source', 'darwin')).toBe('server')
})
it('recognizes portable Linux chassis and tolerates unavailable metadata', () => {
  expect(detectRuntimeType('', 'linux', () => '10\n')).toBe('laptop')
  expect(detectRuntimeType('', 'linux', () => '3')).toBe('desktop')
  expect(
    detectRuntimeType('', 'linux', () => {
      throw new Error('Unavailable')
    }),
  ).toBe('desktop')
  expect(detectRuntimeType('', 'darwin')).toBe('desktop')
})
