import { expect, it } from 'vitest'
import { decodeRuntimeRegistry } from './runtime-registry'
const connection = { address: 'http://remote:8787/', token: 'a-valid-runtime-token-123456' }
it('migrates one saved connection into a selected runtime without losing credentials', () => {
  const migrated = decodeRuntimeRegistry(null, JSON.stringify(connection))
  expect(migrated.profiles).toHaveLength(1)
  expect(migrated.activeId).toBe(migrated.profiles[0].id)
  expect(migrated.profiles[0].connection).toEqual({ ...connection, address: 'http://remote:8787' })
})
it('prefers the saved registry and retains active selection', () => {
  const registry = decodeRuntimeRegistry(null, JSON.stringify(connection))
  expect(decodeRuntimeRegistry(JSON.stringify(registry), 'broken legacy value')).toEqual(registry)
})
it('does not overwrite malformed saved runtime credentials', () => {
  expect(() => decodeRuntimeRegistry('broken', JSON.stringify(connection))).toThrow(SyntaxError)
  expect(() => decodeRuntimeRegistry(null, 'broken')).toThrow(SyntaxError)
})
