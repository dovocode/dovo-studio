import { expect, it } from 'vitest'
import { credentialFields, credentialValues } from './credential-fields'
it('preserves hidden credentials until explicitly replaced or removed', () => {
  const fields = credentialFields({ API_KEY: 'dovo-stored-secret:opaque', OTHER: 'another' })
  expect(fields.every((field) => field.value === '')).toBe(true)
  expect(credentialValues(fields)).toEqual({
    API_KEY: 'dovo-stored-secret:opaque',
    OTHER: 'another',
  })
  expect(credentialValues([{ ...fields[0], replacing: true, value: 'new' }])).toEqual({
    API_KEY: 'new',
  })
  expect(credentialValues([])).toEqual({})
})
it('rejects empty and duplicate names without echoing values', () => {
  expect(() => credentialValues([{ name: '', value: 'secret', replacing: true }])).toThrow(
    'Enter a name',
  )
  expect(() =>
    credentialValues([
      { name: 'A', value: 'secret', replacing: true },
      { name: ' A ', value: 'secret', replacing: true },
    ]),
  ).toThrow('unique name')
})
