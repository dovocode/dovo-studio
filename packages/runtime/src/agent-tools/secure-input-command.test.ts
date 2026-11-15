import { expect, it } from 'vite-plus/test'
import { secureInputCommand } from './secure-input-command.js'

const destination = { kind: 'command', command: '/usr/bin/true', args: [], appendNewline: true }
const request = {
  action: 'request',
  key: 'credential',
  title: 'Sign in',
  prompt: 'Enter privately',
}

it('normalizes only the destination and validates the canonical private-input command', () => {
  for (const value of [destination, JSON.stringify(destination)]) {
    expect(secureInputCommand({ ...request, destination: value })).toEqual({
      ...request,
      destination,
    })
  }
  const callback = { kind: 'auth_callback', installationId: 'install-42' }
  expect(secureInputCommand({ ...request, destination: JSON.stringify(callback) })).toEqual({
    ...request,
    destination: callback,
  })
  expect(secureInputCommand({ action: 'status', id: 'request-42' })).toEqual({
    action: 'status',
    id: 'request-42',
  })
})

it('rejects malformed JSON without returning submitted metadata', () => {
  expect(() => secureInputCommand({ ...request, destination: 'confidential-metadata{' })).toThrow(
    'Secure input destination must contain a valid JSON object.',
  )
})

it.each(['null', '[]', 'true', '42', '"nested-string"', '{"kind":"command"}', '{"kind":"other"}'])(
  'rejects invalid encoded destinations: %s',
  (value) => {
    expect(() => secureInputCommand({ ...request, destination: value })).toThrow('destination')
  },
)
